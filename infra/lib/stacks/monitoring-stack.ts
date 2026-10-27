import { Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as xray from 'aws-cdk-lib/aws-xray';
import type { Construct } from 'constructs';
import { PROJECT_NAME } from '@dinner/shared';
import type { StageConfig } from '../config';

export interface MonitoringStackProps extends StackProps {
  config: StageConfig;
  /** Recipient of budget alerts. Pass with `-c alertEmail=you@example.com`. */
  alertEmail?: string;
}

export class MonitoringStack extends Stack {
  /** Operational alarms (failed or missed jobs) are sent here. */
  readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { config, alertEmail } = props;

    if (!alertEmail) {
      throw new Error('Missing alertEmail context. Pass -c alertEmail=you@example.com or set it in cdk.context.json.');
    }

    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${config.prefix}-alerts`,
      enforceSSL: true,
    });
    this.alertTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));

    const subscribers = [{ subscriptionType: 'EMAIL', address: alertEmail }];
    const notification = (threshold: number, notificationType: 'ACTUAL' | 'FORECASTED') => ({
      notification: {
        comparisonOperator: 'GREATER_THAN',
        notificationType,
        threshold,
        thresholdType: 'PERCENTAGE',
      },
      subscribers,
    });

    // Filters on the `project` cost allocation tag, which must be activated once in
    // Billing → Cost allocation tags after the first tagged resources exist.
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${config.prefix}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
        filterExpression: {
          tags: { key: 'project', values: [PROJECT_NAME], matchOptions: ['EQUALS'] },
        },
      },
      notificationsWithSubscribers: [
        notification(50, 'ACTUAL'),
        notification(80, 'ACTUAL'),
        notification(100, 'FORECASTED'),
      ],
    });

    this.enableTransactionSearch(config.traceIndexingPercentage);
  }

  /**
   * Account-level prerequisite for AgentCore Observability: X-Ray sends spans to the
   * CloudWatch Logs `aws/spans` group, which powers the CloudWatch GenAI Observability views.
   */
  private enableTransactionSearch(indexingPercentage: number) {
    const { account, region, partition } = this;

    const policy = new logs.ResourcePolicy(this, 'XRayToCloudWatchLogsPolicy', {
      resourcePolicyName: 'TransactionSearchXRayAccess',
      policyStatements: [
        new iam.PolicyStatement({
          sid: 'TransactionSearchXRayAccess',
          principals: [new iam.ServicePrincipal('xray.amazonaws.com')],
          actions: ['logs:PutLogEvents'],
          resources: [
            `arn:${partition}:logs:${region}:${account}:log-group:aws/spans:*`,
            `arn:${partition}:logs:${region}:${account}:log-group:/aws/application-signals/data:*`,
          ],
          conditions: {
            ArnLike: { 'aws:SourceArn': `arn:${partition}:xray:${region}:${account}:*` },
            StringEquals: { 'aws:SourceAccount': account },
          },
        }),
      ],
    });

    const transactionSearch = new xray.CfnTransactionSearchConfig(this, 'TransactionSearch', {
      indexingPercentage,
    });
    transactionSearch.node.addDependency(policy);
  }
}
