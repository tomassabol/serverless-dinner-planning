import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { AssetHashType, CfnOutput, DockerImage, Stack, type StackProps } from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { AGENT_MODEL_ID, type StageConfig } from '../config';
import { REPO_ROOT } from '../constructs/node-function';

export interface AgentsStackProps extends StackProps {
  config: StageConfig;
  gateway: agentcore.CfnGateway;
}

export class AgentsStack extends Stack {
  readonly weeklyRuntime: agentcore.CfnRuntime;

  constructor(scope: Construct, id: string, props: AgentsStackProps) {
    super(scope, id, props);
    const { config, gateway } = props;
    const agentsDir = path.join(REPO_ROOT, 'packages/agents');

    // Direct code deployment: an esbuild CommonJS bundle plus vendored ADOT, built by package-runtime.ts.
    const code = new s3assets.Asset(this, 'WeeklyCode', {
      path: agentsDir,
      assetHashType: AssetHashType.OUTPUT,
      bundling: {
        image: DockerImage.fromRegistry('alpine'),
        local: {
          tryBundle(outputDir) {
            execFileSync('pnpm', ['exec', 'tsx', 'scripts/package-runtime.ts', outputDir], {
              cwd: agentsDir,
              stdio: 'inherit',
            });
            return true;
          },
        },
      },
    });

    const role = new iam.Role(this, 'WeeklyRuntimeRole', {
      roleName: `${config.prefix}-weekly-runtime`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:*` },
        },
      }),
    });
    code.grantRead(role);

    const modelName = AGENT_MODEL_ID.replace(/^eu\./, '');
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${AGENT_MODEL_ID}`,
          `arn:${this.partition}:bedrock:*::foundation-model/${modelName}`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ['bedrock-agentcore:InvokeGateway'], resources: [gateway.attrGatewayArn] }),
    );
    // AgentCore Observability: runtime logs, ADOT traces and metrics.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
        resources: ['*'],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
      }),
    );

    const runtimeName = `${config.prefix}-weekly`.replace(/-/g, '_');
    this.weeklyRuntime = new agentcore.CfnRuntime(this, 'WeeklyRuntime', {
      agentRuntimeName: runtimeName,
      description: 'Weekly dinner planner (planner + judge agents)',
      roleArn: role.roleArn,
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: { s3: { bucket: code.s3BucketName, prefix: code.s3ObjectKey } },
          runtime: 'NODE_22',
          entryPoint: ['opentelemetry-instrument', 'main.js'],
        },
      },
      networkConfiguration: { networkMode: 'PUBLIC' },
      lifecycleConfiguration: { idleRuntimeSessionTimeout: 300, maxLifetime: 3600 },
      environmentVariables: {
        GATEWAY_URL: gateway.attrGatewayUrl,
        PLANNER_MODEL_ID: AGENT_MODEL_ID,
        JUDGE_MODEL_ID: AGENT_MODEL_ID,
        AGENT_OBSERVABILITY_ENABLED: 'true',
        OTEL_RESOURCE_ATTRIBUTES: `service.name=${runtimeName},deployment.environment=${config.stage}`,
      },
    });
    this.weeklyRuntime.node.addDependency(role);

    new ssm.StringParameter(this, 'WeeklyRuntimeArnParam', {
      parameterName: `/${config.prefix}/agents/weekly-runtime-arn`,
      stringValue: this.weeklyRuntime.attrAgentRuntimeArn,
    });
    new CfnOutput(this, 'WeeklyRuntimeArn', { value: this.weeklyRuntime.attrAgentRuntimeArn });
  }
}
