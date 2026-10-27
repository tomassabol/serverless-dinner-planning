#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { isStage, STAGES } from '@dinner/shared';
import { getStageConfig, REGION, TAGS } from '../lib/config';
import { AgentsStack } from '../lib/stacks/agents-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { CdnStack } from '../lib/stacks/cdn-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { GatewayStack } from '../lib/stacks/gateway-stack';
import { IngestStack } from '../lib/stacks/ingest-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';
import { WorkflowStack } from '../lib/stacks/workflow-stack';

const app = new App();

const stage = app.node.tryGetContext('stage');
if (!isStage(stage)) {
  throw new Error(`Invalid stage "${stage}". Pass -c stage=<${STAGES.join('|')}>.`);
}

const config = getStageConfig(stage);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

for (const [key, value] of Object.entries(TAGS(stage))) {
  Tags.of(app).add(key, value);
}

const auth = new AuthStack(app, `${config.prefix}-auth`, { env, config });

const monitoring = new MonitoringStack(app, `${config.prefix}-monitoring`, {
  env,
  config,
  alertEmail: app.node.tryGetContext('alertEmail'),
});

const data = new DataStack(app, `${config.prefix}-data`, { env, config });

const ingest = new IngestStack(app, `${config.prefix}-ingest`, {
  env,
  config,
  table: data.table,
  bucket: data.bucket,
  alertTopic: monitoring.alertTopic,
});

const gateway = new GatewayStack(app, `${config.prefix}-gateway`, {
  env,
  config,
  table: data.table,
  bucket: data.bucket,
});

const agents = new AgentsStack(app, `${config.prefix}-agents`, { env, config, gateway: gateway.gateway });

const cdn = new CdnStack(app, `${config.prefix}-cdn`, { env, config });

const alertEmail: string = app.node.tryGetContext('alertEmail');
new WorkflowStack(app, `${config.prefix}-workflow`, {
  env,
  config,
  table: data.table,
  mediaBucket: cdn.mediaBucket,
  mediaBaseUrl: cdn.baseUrl,
  userPool: auth.userPool,
  ingestFn: ingest.fn,
  weeklyRuntimeArn: agents.weeklyRuntime.attrAgentRuntimeArn,
  alertTopic: monitoring.alertTopic,
  senderEmail: app.node.tryGetContext('senderEmail') ?? alertEmail,
  verifiedRecipients: app.node.tryGetContext('householdEmails') ?? [],
});
