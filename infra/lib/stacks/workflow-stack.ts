import { Annotations, Duration, Stack, TimeZone, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import * as ses from 'aws-cdk-lib/aws-ses';
import type * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config';
import { NodeFunction } from '../constructs/node-function';

export interface WorkflowStackProps extends StackProps {
  config: StageConfig;
  table: dynamodb.ITableV2;
  mediaBucket: s3.IBucket;
  mediaBaseUrl: string;
  userPool: cognito.IUserPool;
  ingestFn: lambda.IFunction;
  weeklyRuntimeArn: string;
  alertTopic: sns.ITopic;
  /** Verified SES sender. */
  senderEmail: string;
  /** Addresses verified for SES sandbox delivery (household members). */
  verifiedRecipients: string[];
}

const weeklyPlanServiceName = 'workflow-weekly-plan';
const WEEKLY_PLAN_ALIAS = 'live';

/** Qualified name of the weekly plan function's alias; durable functions can't be invoked unqualified. */
export const weeklyPlanFunctionName = (config: StageConfig) => `${config.prefix}-${weeklyPlanServiceName}:${WEEKLY_PLAN_ALIAS}`;

/** Image model lives in us-west-2: no text-to-image model is offered in the EU regions. */
const IMAGE_MODEL_ARN = 'arn:aws:bedrock:us-west-2::foundation-model/stability.stable-image-core-v1:1';

export class WorkflowStack extends Stack {
  readonly weeklyPlan: lambda.Alias;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
    super(scope, id, props);
    const { config, table, mediaBucket, userPool } = props;

    for (const email of new Set([props.senderEmail, ...props.verifiedRecipients])) {
      new ses.EmailIdentity(this, `Identity-${email.replace(/[^a-zA-Z0-9]/g, '')}`, {
        identity: ses.Identity.email(email),
      });
    }

    const fn = (name: string, serviceName: string, timeout: Duration, environment: Record<string, string> = {}) =>
      new NodeFunction(this, name, {
        config,
        serviceName,
        entry: `packages/workflow/src/handlers/${serviceName.replace(/^workflow-/, '')}.ts`,
        timeout,
        environment,
      });

    const planFn = fn('PlanFunction', 'workflow-plan', Duration.minutes(14), { RUNTIME_ARN: props.weeklyRuntimeArn });
    planFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [props.weeklyRuntimeArn, `${props.weeklyRuntimeArn}/*`],
      }),
    );

    const imageFn = fn('ImageFunction', 'workflow-image', Duration.seconds(90), {
      MEDIA_BUCKET: mediaBucket.bucketName,
      MEDIA_BASE_URL: props.mediaBaseUrl,
      TABLE_NAME: table.tableName,
    });
    mediaBucket.grantReadWrite(imageFn, 'images/*');
    // Chat edits invoke this function directly (attach mode) to put the new photo into the stored plan.
    table.grantReadWriteData(imageFn);
    imageFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [IMAGE_MODEL_ARN] }));

    // The orchestrator is a durable function: planner and image Lambdas are chained invokes, and
    // saving, attaching images and the email run as checkpointed steps inside it.
    const weeklyFn = new NodeFunction(this, 'WeeklyPlanFunction', {
      config,
      serviceName: weeklyPlanServiceName,
      entry: 'packages/workflow/src/handlers/weekly-plan.ts',
      description: 'Durable weekly plan workflow: offers, plan, save, photos, email',
      timeout: Duration.minutes(5),
      durableConfig: { executionTimeout: Duration.minutes(45), retentionPeriod: Duration.days(30) },
      environment: {
        INGEST_FUNCTION_ARN: props.ingestFn.functionArn,
        PLAN_FUNCTION_ARN: planFn.functionArn,
        IMAGE_FUNCTION_ARN: imageFn.functionArn,
        TABLE_NAME: table.tableName,
        USER_POOL_ID: userPool.userPoolId,
        SENDER_EMAIL: props.senderEmail,
      },
    });
    Annotations.of(weeklyFn).acknowledgeInfo(
      'aws-lambda:Function.DurableConfig',
      'Created durable from the start, so the replacement warning does not apply',
    );
    for (const target of [props.ingestFn, planFn, imageFn]) target.grantInvoke(weeklyFn);
    table.grantReadWriteData(weeklyFn);
    weeklyFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['cognito-idp:ListUsers'], resources: [userPool.userPoolArn] }));
    weeklyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [`arn:${this.partition}:ses:${this.region}:${this.account}:identity/*`],
      }),
    );
    // Durable executions must be started through a version or alias; each one stays pinned to the
    // version it started on, so a deploy never changes the code under a running execution.
    this.weeklyPlan = new lambda.Alias(this, 'WeeklyPlanAlias', {
      aliasName: WEEKLY_PLAN_ALIAS,
      version: weeklyFn.currentVersion,
    });

    new scheduler.Schedule(this, 'SundaySchedule', {
      scheduleName: `${config.prefix}-weekly-plan`,
      description: 'Plans next week every Sunday at 17:00 Danish time',
      schedule: scheduler.ScheduleExpression.cron({
        minute: '0',
        hour: '17',
        weekDay: 'SUN',
        timeZone: TimeZone.of('Europe/Copenhagen'),
      }),
      target: new targets.LambdaInvoke(this.weeklyPlan, {
        input: scheduler.ScheduleTargetInput.fromObject({ householdId: 'home', week: 'next' }),
        retryAttempts: 1,
      }),
    });

    const alarmAction = new cwActions.SnsAction(props.alertTopic);
    for (const [name, metricName] of [
      ['failed', 'DurableExecutionFailed'],
      ['timed-out', 'DurableExecutionTimedOut'],
    ] as const) {
      new cloudwatch.Alarm(this, `WeeklyPlan-${name}`, {
        alarmName: `${config.prefix}-weekly-plan-${name}`,
        alarmDescription: `The weekly plan workflow ${name.replace('-', ' ')}`,
        metric: weeklyFn.metric(metricName, { period: Duration.hours(1), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(alarmAction);
    }
  }
}
