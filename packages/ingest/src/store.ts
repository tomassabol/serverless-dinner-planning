import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  BatchWriteCommand,
  type BatchWriteCommandOutput,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { Offer, OfferTags } from '@dinner/shared';

const RETENTION_SECONDS = 30 * 24 * 3600;
const MAX_ATTEMPTS = 5;

export const offerKey = (id: string) => ({ pk: `OFFER#${id}`, sk: 'OFFER' });

export class OfferStore {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly s3: S3Client,
    private readonly tableName: string,
    private readonly bucketName: string,
  ) {}

  async putJson(key: string, body: unknown) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(body),
        ContentType: 'application/json',
      }),
    );
  }

  /** Returns the tags already stored for the given offer ids. */
  async getExistingTags(ids: string[]): Promise<Map<string, OfferTags | null>> {
    const found = new Map<string, OfferTags | null>();
    for (const batch of chunk(ids, 100)) {
      let keys: Record<string, unknown>[] | undefined = batch.map(offerKey);
      for (let attempt = 1; keys?.length && attempt <= MAX_ATTEMPTS; attempt++) {
        const response: BatchGetCommandOutput = await this.ddb.send(
          new BatchGetCommand({
            RequestItems: { [this.tableName]: { Keys: keys, ProjectionExpression: 'id, tags' } },
          }),
        );
        for (const item of response.Responses?.[this.tableName] ?? []) {
          found.set(item.id as string, (item.tags as OfferTags | undefined) ?? null);
        }
        keys = response.UnprocessedKeys?.[this.tableName]?.Keys;
        if (keys?.length) await backoff(attempt);
      }
      if (keys?.length) throw new Error(`BatchGet left ${keys.length} unprocessed keys`);
    }
    return found;
  }

  async putOffers(offers: Offer[]) {
    for (const batch of chunk(offers, 25)) {
      let requests: Record<string, unknown>[] | undefined = batch.map((offer) => ({
        PutRequest: { Item: toItem(offer) },
      }));
      for (let attempt = 1; requests?.length && attempt <= MAX_ATTEMPTS; attempt++) {
        const response: BatchWriteCommandOutput = await this.ddb.send(
          new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } }),
        );
        requests = response.UnprocessedItems?.[this.tableName];
        if (requests?.length) await backoff(attempt);
      }
      if (requests?.length) throw new Error(`BatchWrite left ${requests.length} unprocessed items`);
    }
  }
}

function toItem(offer: Offer) {
  return {
    ...offerKey(offer.id),
    gsi1pk: `CHAIN#${offer.chain}`,
    gsi1sk: `${offer.validFrom}#${offer.id}`,
    expiresAt: Math.floor(new Date(offer.validTo).getTime() / 1000) + RETENTION_SECONDS,
    ...offer,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
