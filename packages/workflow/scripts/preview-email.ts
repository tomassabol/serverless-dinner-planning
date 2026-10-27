/**
 * Renders the plan email for a MealPlan JSON file (e.g. from `pnpm --filter @dinner/agents invoke next out.json`),
 * with the shopping list built from the offers in DynamoDB.
 * Usage: AWS_PROFILE=tomassabol pnpm --filter @dinner/workflow preview-email <plan.json> <out.html> [imageUrl]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  MealPlanSchema,
  OfferSchema,
  type Offer,
  type StoredPlan,
  buildShoppingList,
} from '@dinner/shared';
import { renderPlanEmail } from '../src/email/render.js';

const [planPath, outPath, imageUrl] = process.argv.slice(2);
if (!planPath || !outPath) throw new Error('Usage: preview-email <plan.json> <out.html> [imageUrl]');

const plan = MealPlanSchema.parse(JSON.parse(readFileSync(planPath, 'utf8')));
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-west-1' }));
const ids = [...new Set(plan.dinners.flatMap((d) => d.ingredients.map((i) => i.offerId)).filter((id): id is string => !!id))];
const response = await ddb.send(
  new BatchGetCommand({ RequestItems: { 'dinner-prod-main': { Keys: ids.map((id) => ({ pk: `OFFER#${id}`, sk: 'OFFER' })) } } }),
);
const offers = new Map<string, Offer>((response.Responses?.['dinner-prod-main'] ?? []).map((i) => [i.id as string, OfferSchema.parse(i)]));

const stored: StoredPlan = {
  ...plan,
  dinners: plan.dinners.map((d) => ({ ...d, imageUrl: imageUrl ?? null })),
  shoppingList: buildShoppingList(plan.dinners, offers),
  state: 'ready',
  executionId: null,
  updatedAt: new Date().toISOString(),
};
const { subject, html } = renderPlanEmail(stored);
writeFileSync(outPath, html);
console.log(subject);
