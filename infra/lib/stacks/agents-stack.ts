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
  readonly chatRuntime: agentcore.CfnRuntime;
  readonly memory: agentcore.CfnMemory;

  constructor(scope: Construct, id: string, props: AgentsStackProps) {
    super(scope, id, props);
    const { config, gateway } = props;
    const agentsDir = path.join(REPO_ROOT, 'packages/agents');

    // Direct code deployment: esbuild CommonJS bundles (main.js, chat.js) plus vendored ADOT, built by package-runtime.ts.
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

    // Household-scoped long-term memory (the actor is the household); namespaces match MEMORY_NAMESPACES in the chat agent.
    this.memory = new agentcore.CfnMemory(this, 'Memory', {
      name: `${config.prefix}-memory`.replace(/-/g, '_'),
      description: 'Dinner chat: conversations (short-term) and household tastes and facts (long-term)',
      eventExpiryDuration: 90,
      memoryStrategies: [
        {
          userPreferenceMemoryStrategy: {
            name: 'preferences',
            description: 'Food likes, dislikes and habits of the household members',
            namespaces: ['/households/{actorId}/preferences'],
          },
        },
        {
          semanticMemoryStrategy: {
            name: 'facts',
            description: 'Facts about the household, its kitchen and past meals',
            namespaces: ['/households/{actorId}/facts'],
          },
        },
        {
          summaryMemoryStrategy: {
            name: 'summaries',
            description: 'Summary of each conversation',
            namespaces: ['/households/{actorId}/sessions/{sessionId}'],
          },
        },
      ],
    });

    this.weeklyRuntime = this.runtime('Weekly', {
      config,
      code,
      gateway,
      entry: 'main.js',
      description: 'Weekly dinner planner (planner + judge agents)',
      environment: { PLANNER_MODEL_ID: AGENT_MODEL_ID, JUDGE_MODEL_ID: AGENT_MODEL_ID },
    });

    this.chatRuntime = this.runtime('Chat', {
      config,
      code,
      gateway,
      entry: 'chat.js',
      description: 'Household dinner chat agent',
      environment: { CHAT_MODEL_ID: AGENT_MODEL_ID, MEMORY_ID: this.memory.attrMemoryId },
      policies: [
        new iam.PolicyStatement({
          actions: [
            'bedrock-agentcore:CreateEvent',
            'bedrock-agentcore:ListEvents',
            'bedrock-agentcore:GetEvent',
            'bedrock-agentcore:RetrieveMemoryRecords',
            'bedrock-agentcore:ListMemoryRecords',
          ],
          resources: [this.memory.attrMemoryArn],
        }),
      ],
    });

    // Construct ids are kept stable so existing parameters update in place.
    for (const [constructId, name, value] of [
      ['WeeklyRuntimeArnParam', 'weekly-runtime-arn', this.weeklyRuntime.attrAgentRuntimeArn],
      ['ChatRuntimeArnParam', 'chat-runtime-arn', this.chatRuntime.attrAgentRuntimeArn],
      ['MemoryIdParam', 'memory-id', this.memory.attrMemoryId],
    ] as const) {
      new ssm.StringParameter(this, constructId, { parameterName: `/${config.prefix}/agents/${name}`, stringValue: value });
    }
    new CfnOutput(this, 'WeeklyRuntimeArn', { value: this.weeklyRuntime.attrAgentRuntimeArn });
    new CfnOutput(this, 'ChatRuntimeArn', { value: this.chatRuntime.attrAgentRuntimeArn });
    new CfnOutput(this, 'MemoryId', { value: this.memory.attrMemoryId });
  }

  private runtime(
    id: string,
    opts: {
      config: StageConfig;
      code: s3assets.Asset;
      gateway: agentcore.CfnGateway;
      entry: string;
      description: string;
      environment: Record<string, string>;
      policies?: iam.PolicyStatement[];
    },
  ): agentcore.CfnRuntime {
    const { config, code, gateway } = opts;
    const runtimeName = `${config.prefix}-${id.toLowerCase()}`.replace(/-/g, '_');

    const role = new iam.Role(this, `${id}RuntimeRole`, {
      roleName: `${config.prefix}-${id.toLowerCase()}-runtime`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: { 'aws:SourceArn': `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:*` },
        },
      }),
    });
    code.grantRead(role);

    const modelName = AGENT_MODEL_ID.replace(/^eu\./, '');
    const statements = [
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${AGENT_MODEL_ID}`,
          `arn:${this.partition}:bedrock:*::foundation-model/${modelName}`,
        ],
      }),
      new iam.PolicyStatement({ actions: ['bedrock-agentcore:InvokeGateway'], resources: [gateway.attrGatewayArn] }),
      // AgentCore Observability: runtime logs, ADOT traces and metrics.
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
      }),
      new iam.PolicyStatement({
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:*`],
      }),
      new iam.PolicyStatement({
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords', 'xray:GetSamplingRules', 'xray:GetSamplingTargets'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' } },
      }),
      ...(opts.policies ?? []),
    ];
    for (const statement of statements) role.addToPolicy(statement);

    const runtime = new agentcore.CfnRuntime(this, `${id}Runtime`, {
      agentRuntimeName: runtimeName,
      description: opts.description,
      roleArn: role.roleArn,
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: { s3: { bucket: code.s3BucketName, prefix: code.s3ObjectKey } },
          runtime: 'NODE_22',
          entryPoint: ['opentelemetry-instrument', opts.entry],
        },
      },
      networkConfiguration: { networkMode: 'PUBLIC' },
      lifecycleConfiguration: { idleRuntimeSessionTimeout: 300, maxLifetime: 3600 },
      environmentVariables: {
        GATEWAY_URL: gateway.attrGatewayUrl,
        AGENT_OBSERVABILITY_ENABLED: 'true',
        OTEL_RESOURCE_ATTRIBUTES: `service.name=${runtimeName},deployment.environment=${config.stage}`,
        ...opts.environment,
      },
    });
    runtime.node.addDependency(role);
    return runtime;
  }
}
