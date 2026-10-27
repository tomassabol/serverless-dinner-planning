import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import type * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config';
import { NodeFunction } from '../constructs/node-function';

export interface ApiStackProps extends StackProps {
  config: StageConfig;
  table: dynamodb.ITableV2;
  userPool: cognito.IUserPool;
  chatRuntime: agentcore.CfnRuntime;
  memory: agentcore.CfnMemory;
  /** Origins allowed for browser calls during local development (production is same-origin via CloudFront). */
  devOrigins: string[];
}

/**
 * REST API for the web app. The Cognito authorizer validates the ID token (it carries
 * `custom:householdId`); handlers read identity only from the verified claims.
 */
export class ApiStack extends Stack {
  readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table, userPool, chatRuntime, memory } = props;

    const chatFn = new NodeFunction(this, 'ChatFunction', {
      config,
      serviceName: 'chat-api',
      entry: 'packages/api/src/chat.ts',
      description: 'Streams chat turns from the AgentCore chat runtime',
      timeout: Duration.minutes(10),
      environment: { CHAT_RUNTIME_ARN: chatRuntime.attrAgentRuntimeArn, TABLE_NAME: table.tableName },
    });
    table.grantReadWriteData(chatFn);
    chatFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [chatRuntime.attrAgentRuntimeArn, `${chatRuntime.attrAgentRuntimeArn}/*`],
      }),
    );

    const apiFn = new NodeFunction(this, 'ApiFunction', {
      config,
      serviceName: 'api',
      entry: 'packages/api/src/api.ts',
      description: 'Conversations and plans for the web app',
      timeout: Duration.seconds(15),
      environment: { TABLE_NAME: table.tableName, MEMORY_ID: memory.attrMemoryId },
    });
    table.grantReadData(apiFn);
    apiFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock-agentcore:ListEvents'], resources: [memory.attrMemoryArn] }));

    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      logGroupName: `/aws/apigateway/${config.prefix}-api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.removalPolicy,
    });

    this.api = new apigw.RestApi(this, 'Api', {
      restApiName: `${config.prefix}-api`,
      description: 'Dinner planner web API',
      endpointTypes: [apigw.EndpointType.REGIONAL],
      deployOptions: {
        stageName: config.stage,
        throttlingRateLimit: 5,
        throttlingBurstLimit: 10,
        tracingEnabled: true,
        accessLogDestination: new apigw.LogGroupLogDestination(accessLogs),
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: props.devOrigins,
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
      },
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      authorizerName: `${config.prefix}-cognito`,
      cognitoUserPools: [userPool],
    });
    const auth = { authorizer, authorizationType: apigw.AuthorizationType.COGNITO };

    this.api.root.addResource('chat').addMethod(
      'POST',
      new apigw.LambdaIntegration(chatFn, {
        responseTransferMode: apigw.ResponseTransferMode.STREAM,
        timeout: Duration.minutes(10),
      }),
      auth,
    );

    const api = new apigw.LambdaIntegration(apiFn);
    const conversations = this.api.root.addResource('conversations');
    conversations.addMethod('GET', api, auth);
    conversations.addResource('{id}').addMethod('GET', api, auth);
    this.api.root.addResource('plans').addResource('{week}').addMethod('GET', api, auth);

    new ssm.StringParameter(this, 'ApiUrlParam', { parameterName: `/${config.prefix}/api/url`, stringValue: this.api.url });
    new CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }
}
