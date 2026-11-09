import Anthropic from '@anthropic-ai/sdk';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { ChainIdSchema, HouseholdIdSchema } from '@dinner/shared';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { runIngest } from './ingest.js';
import { loadMarkets } from './households.js';
import { AxfoodOfferSource } from './sources/axfood.js';
import { TjekOfferSource } from './sources/tjek.js';
import { OfferStore } from './store.js';
import { OfferTagger } from './tagger.js';

const env = z
  .object({
    TABLE_NAME: z.string(),
    BUCKET_NAME: z.string(),
    TAG_MODEL_ID: z.string(),
    ANTHROPIC_API_KEY_SECRET_ARN: z.string(),
  })
  .parse(process.env);

const logger = new Logger({ serviceName: 'ingest' });
const metrics = new Metrics({ namespace: 'DinnerPlanner', serviceName: 'ingest' });
const tracer = new Tracer({ serviceName: 'ingest' });

const ddb = DynamoDBDocumentClient.from(tracer.captureAWSv3Client(new DynamoDBClient({})), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = tracer.captureAWSv3Client(new S3Client({}));
const secrets = tracer.captureAWSv3Client(new SecretsManagerClient({}));
const { SecretString: apiKey } = await secrets.send(new GetSecretValueCommand({ SecretId: env.ANTHROPIC_API_KEY_SECRET_ARN }));
const anthropic = new Anthropic({ apiKey });

const EventSchema = z
  .object({
    chains: z.array(ChainIdSchema).optional(),
    /** Only refresh the markets of these households (the weekly workflow and settings changes pass one). */
    householdIds: z.array(HouseholdIdSchema).optional(),
    skipTagging: z.boolean().optional(),
  })
  .default({});

export const handler = async (event: unknown, context: Context) => {
  logger.addContext(context);
  const { householdIds, ...options } = EventSchema.parse(event ?? {});
  const markets = await loadMarkets(ddb, env.TABLE_NAME, householdIds);
  logger.info('Ingesting markets', { markets: markets.map((m) => m.key) });

  const result = await runIngest(
    {
      sources: { tjek: new TjekOfferSource(), axfood: new AxfoodOfferSource() },
      store: new OfferStore(ddb, s3, env.TABLE_NAME, env.BUCKET_NAME),
      tagger: new OfferTagger(anthropic, env.TAG_MODEL_ID, (error, offerIds) =>
        logger.warn('Tagging batch failed', { error, offers: offerIds.length }),
      ),
      log: (message, data) => logger.info(message, data ?? {}),
    },
    { ...options, markets },
  );

  for (const chain of result.chains) {
    const single = metrics.singleMetric();
    single.addDimension('chain', chain.chain);
    single.addDimension('market', chain.market.startsWith('se-') ? 'se' : chain.market);
    single.addMetric('OffersFetched', MetricUnit.Count, chain.fetched);
    single.addMetric('ChainFetchFailed', MetricUnit.Count, chain.error ? 1 : 0);
  }
  metrics.addMetric('NewOffers', MetricUnit.Count, result.newOffers);
  metrics.addMetric('OffersTagged', MetricUnit.Count, result.tagged);
  metrics.addMetric('OffersUntagged', MetricUnit.Count, result.untagged);
  metrics.addMetric('TagInputTokens', MetricUnit.Count, result.tagInputTokens);
  metrics.addMetric('TagOutputTokens', MetricUnit.Count, result.tagOutputTokens);
  metrics.addMetric('FailedTagBatches', MetricUnit.Count, result.failedTagBatches);
  metrics.publishStoredMetrics();

  logger.info('Ingest finished', { result });
  return result;
};
