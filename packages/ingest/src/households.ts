import { GetCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DANISH_MARKET,
  PreferencesSchema,
  householdKeys,
  marketFor,
  migratePreferences,
  type OfferMarket,
} from '@dinner/shared';

/**
 * The offer markets to ingest. Denmark is always fetched (it is national and cheap); Swedish markets
 * come from the households that have set a Swedish location. `householdIds` limits it to those households.
 */
export async function loadMarkets(ddb: DynamoDBDocumentClient, tableName: string, householdIds?: string[]): Promise<OfferMarket[]> {
  const items: Record<string, unknown>[] = [];
  if (householdIds) {
    for (const id of householdIds) {
      const { Item } = await ddb.send(new GetCommand({ TableName: tableName, Key: householdKeys.preferences(id) }));
      items.push(Item ?? { householdId: id });
    }
  } else {
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await ddb.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': 'HOUSEHOLDS' },
          ExclusiveStartKey,
        }),
      );
      items.push(...(page.Items ?? []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    items.push({ householdId: 'dk-default' });
  }

  const markets = new Map<string, OfferMarket>();
  for (const item of items) {
    const parsed = PreferencesSchema.safeParse(migratePreferences(item));
    const market = parsed.success ? marketFor(parsed.data.market) : DANISH_MARKET;
    if (market) markets.set(market.key, market);
  }
  return [...markets.values()].sort((a, b) => a.key.localeCompare(b.key));
}
