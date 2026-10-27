import { Duration, Stack, TimeZone, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import * as ses from 'aws-cdk-lib/aws-ses';
import type * as sns from 'aws-cdk-lib/aws-sns';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
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

export const weeklyPlanStateMachineName = (config: StageConfig) => `${config.prefix}-weekly-plan`;

/** Image model lives in us-west-2: no text-to-image model is offered in the EU regions. */
const IMAGE_MODEL_ARN = 'arn:aws:bedrock:us-west-2::foundation-model/stability.stable-image-core-v1:1';

export class WorkflowStack extends Stack {
  readonly stateMachine: sfn.StateMachine;

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

    const saveFn = fn('SavePlanFunction', 'workflow-save-plan', Duration.seconds(30), { TABLE_NAME: table.tableName });
    table.grantReadWriteData(saveFn);

    const imageFn = fn('ImageFunction', 'workflow-image', Duration.seconds(90), {
      MEDIA_BUCKET: mediaBucket.bucketName,
      MEDIA_BASE_URL: props.mediaBaseUrl,
      TABLE_NAME: table.tableName,
    });
    mediaBucket.grantReadWrite(imageFn, 'images/*');
    // Chat edits invoke this function directly (attach mode) to put the new photo into the stored plan.
    table.grantReadWriteData(imageFn);
    imageFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [IMAGE_MODEL_ARN] }));

    const attachFn = fn('AttachImagesFunction', 'workflow-attach-images', Duration.seconds(30), { TABLE_NAME: table.tableName });
    table.grantReadWriteData(attachFn);

    const emailFn = fn('EmailFunction', 'workflow-email', Duration.seconds(30), {
      TABLE_NAME: table.tableName,
      USER_POOL_ID: userPool.userPoolId,
      SENDER_EMAIL: props.senderEmail,
    });
    table.grantReadData(emailFn);
    emailFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['cognito-idp:ListUsers'], resources: [userPool.userPoolArn] }));
    emailFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail'],
        resources: [`arn:${this.partition}:ses:${this.region}:${this.account}:identity/*`],
      }),
    );

    this.stateMachine = new sfn.StateMachine(this, 'WeeklyPlan', {
      stateMachineName: weeklyPlanStateMachineName(config),
      definitionBody: sfn.DefinitionBody.fromChainable(this.definition({ planFn, saveFn, imageFn, attachFn, emailFn, ingestFn: props.ingestFn })),
      timeout: Duration.minutes(45),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'WeeklyPlanLogs', {
          logGroupName: `/aws/vendedlogs/states/${config.prefix}-weekly-plan`,
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: config.removalPolicy,
        }),
        level: sfn.LogLevel.ERROR,
      },
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
      target: new targets.StepFunctionsStartExecution(this.stateMachine, {
        input: scheduler.ScheduleTargetInput.fromObject({ householdId: 'home', week: 'next' }),
        retryAttempts: 1,
      }),
    });

    const alarmAction = new cwActions.SnsAction(props.alertTopic);
    for (const [name, metric] of [
      ['failed', this.stateMachine.metricFailed({ period: Duration.hours(1), statistic: 'Sum' })],
      ['timed-out', this.stateMachine.metricTimedOut({ period: Duration.hours(1), statistic: 'Sum' })],
    ] as const) {
      new cloudwatch.Alarm(this, `WeeklyPlan-${name}`, {
        alarmName: `${config.prefix}-weekly-plan-${name}`,
        alarmDescription: `The weekly plan workflow ${name.replace('-', ' ')}`,
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(alarmAction);
    }
  }

  private definition(fns: Record<'planFn' | 'saveFn' | 'imageFn' | 'attachFn' | 'emailFn' | 'ingestFn', lambda.IFunction>) {
    const invoke = (id: string, lambdaFunction: lambda.IFunction, payload: Record<string, unknown>, props: Partial<tasks.LambdaInvokeProps> = {}) =>
      new tasks.LambdaInvoke(this, id, {
        lambdaFunction,
        payload: sfn.TaskInput.fromObject(payload),
        payloadResponseOnly: true,
        retryOnServiceExceptions: true,
        ...props,
      });

    // Input: { householdId, week?, skipFetch?, sendEmail? }. Re-plans from chat pass skipFetch: true.
    const defaults = new sfn.Pass(this, 'ApplyDefaults', {
      parameters: {
        'input.$': "States.JsonMerge(States.StringToJson('{\"week\":\"next\",\"skipFetch\":false,\"sendEmail\":true}'), $, false)",
      },
      outputPath: '$.input',
    });

    const refresh = invoke('RefreshOffers', fns.ingestFn, {}, { resultPath: sfn.JsonPath.DISCARD });

    const plan = invoke(
      'PlanWeek',
      fns.planFn,
      {
        'householdId.$': '$.householdId',
        'week.$': '$.week',
        'executionName.$': '$$.Execution.Name',
      },
      // A run costs model tokens, so only Lambda service hiccups are retried, not plan failures.
      { resultPath: '$.plan', taskTimeout: sfn.Timeout.duration(Duration.minutes(14)) },
    );

    const save = invoke('SavePlan', fns.saveFn, { 'plan.$': '$.plan', 'executionId.$': '$$.Execution.Id' }, { resultPath: '$.saved' });

    const image = invoke('GenerateImage', fns.imageFn, {
      'householdId.$': '$.householdId',
      'week.$': '$.week',
      'dinner.$': '$.dinner',
    }).addRetry({ errors: ['States.ALL'], maxAttempts: 1, interval: Duration.seconds(5) });
    // One failed image must not block the email.
    image.addCatch(new sfn.Pass(this, 'ImageFailed', { parameters: { 'date.$': '$.dinner.date', imageUrl: null } }), {
      resultPath: '$.error',
    });

    const images = new sfn.Map(this, 'GenerateImages', {
      itemsPath: '$.saved.dinners',
      itemSelector: {
        'householdId.$': '$.saved.householdId',
        'week.$': '$.saved.week',
        'dinner.$': '$$.Map.Item.Value',
      },
      maxConcurrency: 3,
      resultPath: '$.images',
    }).itemProcessor(image);

    const attach = invoke(
      'AttachImages',
      fns.attachFn,
      { 'householdId.$': '$.saved.householdId', 'week.$': '$.saved.week', 'images.$': '$.images' },
      { resultPath: sfn.JsonPath.DISCARD },
    );

    const email = invoke('SendEmail', fns.emailFn, { 'householdId.$': '$.saved.householdId', 'week.$': '$.saved.week' }, { resultPath: '$.email' });
    const done = new sfn.Succeed(this, 'Done');

    return defaults
      .next(new sfn.Choice(this, 'FetchOffers?').when(sfn.Condition.booleanEquals('$.skipFetch', false), refresh).afterwards({ includeOtherwise: true }))
      .next(plan)
      .next(save)
      .next(images)
      .next(attach)
      .next(new sfn.Choice(this, 'SendEmail?').when(sfn.Condition.booleanEquals('$.sendEmail', true), email.next(done)).otherwise(done));
  }
}
