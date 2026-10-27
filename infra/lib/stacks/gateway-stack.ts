import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config';
import { NodeFunction, REPO_ROOT } from '../constructs/node-function';
import { weeklyPlanStateMachineName } from './workflow-stack';

export interface GatewayStackProps extends StackProps {
  config: StageConfig;
  table: dynamodb.ITableV2;
  bucket: s3.IBucket;
}

/** Name of the Lambda target; tools are exposed to agents as `dinner-tools___<tool>`. */
export const TOOLS_TARGET_NAME = 'dinner-tools';

export class GatewayStack extends Stack {
  readonly gateway: agentcore.CfnGateway;

  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props);
    const { config, table, bucket } = props;
    const weeklyPlanArn = `arn:${this.partition}:states:${this.region}:${this.account}:stateMachine:${weeklyPlanStateMachineName(config)}`;
    const imageFunctionName = `${config.prefix}-workflow-image`;

    const toolsFn = new NodeFunction(this, 'ToolsFunction', {
      config,
      serviceName: 'tools',
      entry: 'packages/tools/src/handler.ts',
      description: 'AgentCore Gateway tools: offers, nutrition, preferences, meal history',
      memorySize: 1024,
      timeout: Duration.seconds(20),
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: bucket.bucketName,
        STATE_MACHINE_ARN: weeklyPlanArn,
        IMAGE_FUNCTION_NAME: imageFunctionName,
      },
      bundling: { loader: { '.json': 'json' } },
    });
    table.grantReadWriteData(toolsFn);
    bucket.grantRead(toolsFn, 'snapshots/*');
    // Chat tools start re-plans and request meal photos from the Workflow stack. The ARNs are built
    // from names, because a CloudFormation reference would make Gateway -> Agents -> Workflow a cycle.
    toolsFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['states:StartExecution'], resources: [weeklyPlanArn] }));
    toolsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [`arn:${this.partition}:lambda:${this.region}:${this.account}:function:${imageFunctionName}`],
      }),
    );

    const interceptorFn = new NodeFunction(this, 'InterceptorFunction', {
      config,
      serviceName: 'gateway-interceptor',
      entry: 'packages/tools/src/interceptor.ts',
      description: 'Injects the trusted household id into tool calls and blocks write tools outside chat',
      memorySize: 256,
      timeout: Duration.seconds(5),
    });

    const role = new iam.Role(this, 'GatewayRole', {
      roleName: `${config.prefix}-gateway`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:*` },
        },
      }),
    });
    toolsFn.grantInvoke(role);
    interceptorFn.grantInvoke(role);

    // AWS_IAM: only principals with bedrock-agentcore:InvokeGateway (our agent runtimes) can call it.
    this.gateway = new agentcore.CfnGateway(this, 'Gateway', {
      name: `${config.prefix}-gateway`,
      description: 'MCP tools for the dinner planner agents',
      protocolType: 'MCP',
      authorizerType: 'AWS_IAM',
      roleArn: role.roleArn,
      interceptorConfigurations: [
        {
          interceptor: { lambda: { arn: interceptorFn.functionArn } },
          interceptionPoints: ['REQUEST'],
          inputConfiguration: { passRequestHeaders: true },
        },
      ],
    });
    this.gateway.node.addDependency(role);

    const toolSchema = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages/tools/data/tool-schema.json'), 'utf8'),
    ) as agentcore.CfnGatewayTarget.ToolDefinitionProperty[];

    new agentcore.CfnGatewayTarget(this, 'ToolsTarget', {
      gatewayIdentifier: this.gateway.attrGatewayIdentifier,
      name: TOOLS_TARGET_NAME,
      description: 'Offers, nutrition, preferences and meal history',
      targetConfiguration: {
        mcp: { lambda: { lambdaArn: toolsFn.functionArn, toolSchema: { inlinePayload: toolSchema } } },
      },
      credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
    });

    this.enableObservability(config);

    new ssm.StringParameter(this, 'GatewayUrlParam', {
      parameterName: `/${config.prefix}/gateway/url`,
      stringValue: this.gateway.attrGatewayUrl,
    });
    new ssm.StringParameter(this, 'GatewayArnParam', {
      parameterName: `/${config.prefix}/gateway/arn`,
      stringValue: this.gateway.attrGatewayArn,
    });
    new CfnOutput(this, 'GatewayUrl', { value: this.gateway.attrGatewayUrl });
    new CfnOutput(this, 'GatewayArn', { value: this.gateway.attrGatewayArn });
  }

  /** AgentCore Observability: vended application logs to CloudWatch and traces to X-Ray. */
  private enableObservability(config: StageConfig) {
    const logGroup = new logs.LogGroup(this, 'GatewayLogs', {
      logGroupName: `/aws/vendedlogs/bedrock-agentcore/${config.prefix}-gateway`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.removalPolicy,
    });

    const deliveries = [
      {
        id: 'Logs',
        logType: 'APPLICATION_LOGS',
        destination: { destinationResourceArn: logGroup.logGroupArn, deliveryDestinationType: undefined },
      },
      { id: 'Traces', logType: 'TRACES', destination: { deliveryDestinationType: 'XRAY' } },
    ];

    for (const { id, logType, destination } of deliveries) {
      const source = new logs.CfnDeliverySource(this, `${id}Source`, {
        name: `${config.prefix}-gateway-${id.toLowerCase()}`,
        logType,
        resourceArn: this.gateway.attrGatewayArn,
      });
      const target = new logs.CfnDeliveryDestination(this, `${id}Destination`, {
        name: `${config.prefix}-gateway-${id.toLowerCase()}`,
        ...destination,
      });
      new logs.CfnDelivery(this, `${id}Delivery`, {
        deliverySourceName: source.ref,
        deliveryDestinationArn: target.attrArn,
      });
    }
  }
}
