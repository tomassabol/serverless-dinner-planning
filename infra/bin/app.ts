#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { isStage, STAGES } from '@dinner/shared';
import { getStageConfig, REGION, TAGS } from '../lib/config';
import { AuthStack } from '../lib/stacks/auth-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { GatewayStack } from '../lib/stacks/gateway-stack';
import { IngestStack } from '../lib/stacks/ingest-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';

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

new AuthStack(app, `${config.prefix}-auth`, { env, config });

const monitoring = new MonitoringStack(app, `${config.prefix}-monitoring`, {
  env,
  config,
  alertEmail: app.node.tryGetContext('alertEmail'),
});

const data = new DataStack(app, `${config.prefix}-data`, { env, config });

new IngestStack(app, `${config.prefix}-ingest`, {
  env,
  config,
  table: data.table,
  bucket: data.bucket,
  alertTopic: monitoring.alertTopic,
});

new GatewayStack(app, `${config.prefix}-gateway`, {
  env,
  config,
  table: data.table,
  bucket: data.bucket,
});
