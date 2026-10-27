import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { ChainIdSchema } from '@dinner/shared';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { runIngest } from './ingest.js';
import { TjekOfferSource } from './sources/tjek.js';
import { OfferStore } from './store.js';
import { OfferTagger } from './tagger.js';

const env = z
  .object({
    TABLE_NAME: z.string(),
    BUCKET_NAME: z.string(),
    TAG_MODEL_ID: z.string(),
  })
  .parse(process.env);

const logger = new Logger({ serviceName: 'ingest' });
const metrics = new Metrics({ namespace: 'DinnerPlanner', serviceName: 'ingest' });
const tracer = new Tracer({ serviceName: 'ingest' });

const ddb = DynamoDBDocumentClient.from(tracer.captureAWSv3Client(new DynamoDBClient({})), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = tracer.captureAWSv3Client(new S3Client({}));
const bedrock = tracer.captureAWSv3Client(new BedrockRuntimeClient({}));

const EventSchema = z
  .object({
    chains: z.array(ChainIdSchema).optional(),
    skipTagging: z.boolean().optional(),
  })
  .default({});

export const handler = async (event: unknown, context: Context) => {
  logger.addContext(context);
  const options = EventSchema.parse(event ?? {});

  const result = await runIngest(
    {
      source: new TjekOfferSource(),
      store: new OfferStore(ddb, s3, env.TABLE_NAME, env.BUCKET_NAME),
      tagger: new OfferTagger(bedrock, env.TAG_MODEL_ID, (error, offerIds) =>
        logger.warn('Tagging batch failed', { error, offers: offerIds.length }),
      ),
      log: (message, data) => logger.info(message, data ?? {}),
    },
    options,
  );

  for (const chain of result.chains) {
    const single = metrics.singleMetric();
    single.addDimension('chain', chain.chain);
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
