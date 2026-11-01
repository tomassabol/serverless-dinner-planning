import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config';

export interface DataStackProps extends StackProps {
  config: StageConfig;
}

export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly bucket: s3.Bucket;
  readonly anthropicApiKey: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;

    // Single table: offers, plans, meal history, preferences and conversations (see docs/plan.md).
    this.table = new dynamodb.TableV2(this, 'Table', {
      tableName: `${config.prefix}-main`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: config.removalPolicy,
      globalSecondaryIndexes: [
        {
          indexName: 'gsi1',
          partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // raw/ keeps the untouched source responses; snapshots/ holds per-week offer files for the tools.
    this.bucket = new s3.Bucket(this, 'DataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: config.removalPolicy,
      lifecycleRules: [
        { id: 'expire-raw', prefix: 'raw/', expiration: Duration.days(90) },
        { id: 'expire-snapshots', prefix: 'snapshots/', expiration: Duration.days(365) },
      ],
    });

    // Claude API key for the tagger and agents. CDK creates a random placeholder; the real value is set
    // out of band with scripts/put-anthropic-key.sh so it never appears in a template.
    this.anthropicApiKey = new secretsmanager.Secret(this, 'AnthropicApiKey', {
      secretName: `${config.prefix}/anthropic-api-key`,
      description: 'Anthropic API key used by the offer tagger and the agents',
      removalPolicy: config.removalPolicy,
    });
  }
}
