import { Duration, Stack, TimeZone, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import type * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import { TAG_MODEL_ID, type StageConfig } from '../config';
import { NodeFunction } from '../constructs/node-function';

export interface IngestStackProps extends StackProps {
  config: StageConfig;
  table: dynamodb.ITableV2;
  bucket: s3.IBucket;
  alertTopic: sns.ITopic;
}

export class IngestStack extends Stack {
  readonly fn: NodeFunction;

  constructor(scope: Construct, id: string, props: IngestStackProps) {
    super(scope, id, props);
    const { config, table, bucket, alertTopic } = props;

    const fn = (this.fn = new NodeFunction(this, 'IngestFunction', {
      config,
      serviceName: 'ingest',
      entry: 'packages/ingest/src/handler.ts',
      description: 'Fetches weekly offers from Tjek, tags them with Bedrock and writes week snapshots',
      memorySize: 1024,
      timeout: Duration.minutes(10),
      retryAttempts: 1,
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: bucket.bucketName,
        TAG_MODEL_ID,
      },
    }));

    table.grantReadWriteData(fn);
    bucket.grantReadWrite(fn);

    // A cross-region inference profile routes to the model in any EU region.
    const modelName = TAG_MODEL_ID.replace(/^eu\./, '');
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${TAG_MODEL_ID}`,
          `arn:${this.partition}:bedrock:*::foundation-model/${modelName}`,
        ],
      }),
    );

    new scheduler.Schedule(this, 'DailySchedule', {
      scheduleName: `${config.prefix}-ingest-daily`,
      description: 'Daily offer ingest at 05:00 Danish time',
      schedule: scheduler.ScheduleExpression.cron({
        minute: '0',
        hour: '5',
        timeZone: TimeZone.of('Europe/Copenhagen'),
      }),
      target: new targets.LambdaInvoke(fn, {
        input: scheduler.ScheduleTargetInput.fromObject({}),
        retryAttempts: 2,
      }),
    });

    const alarmAction = new cwActions.SnsAction(alertTopic);

    new cloudwatch.Alarm(this, 'IngestErrorsAlarm', {
      alarmName: `${config.prefix}-ingest-errors`,
      alarmDescription: 'The offer ingest Lambda failed',
      metric: fn.metricErrors({ period: Duration.hours(1), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    new cloudwatch.Alarm(this, 'IngestMissedAlarm', {
      alarmName: `${config.prefix}-ingest-missed`,
      alarmDescription: 'The offer ingest has not run in the last day',
      metric: fn.metricInvocations({ period: Duration.days(1), statistic: 'Sum' }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(alarmAction);
  }
}
