/** Step Functions task: stores the plan with its shopping list and syncs the meal history. */
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { MealPlanSchema, OfferSchema, type Offer, type StoredPlan } from '@dinner/shared';
import { z } from 'zod';
import { ddb, env, logger } from '../clients.js';
import { PlanRepo } from '../plans.js';
import { buildShoppingList } from '../shopping.js';

const { TABLE_NAME } = env('TABLE_NAME');
const plans = new PlanRepo(ddb, TABLE_NAME);

const InputSchema = z.object({ plan: MealPlanSchema, executionId: z.string() });

export const handler = async (event: unknown) => {
  const { plan, executionId } = InputSchema.parse(event);
  const offers = await loadOffers(plan.dinners.flatMap((d) => d.ingredients.map((i) => i.offerId)));

  const stored: StoredPlan = {
    ...plan,
    dinners: plan.dinners.map((d) => ({ ...d, imageUrl: null })),
    shoppingList: buildShoppingList(plan.dinners, offers),
    state: 'generating_images',
    executionId,
    updatedAt: new Date().toISOString(),
  };
  await plans.put(stored);
  await plans.syncMealHistory(stored);
  logger.info('Plan saved', { householdId: plan.householdId, week: plan.week, offers: offers.size });

  // Only what the image step needs travels on through the state machine.
  return {
    householdId: plan.householdId,
    week: plan.week,
    dinners: plan.dinners.map(({ date, dish, description, cuisine }) => ({ date, dish, description, cuisine })),
  };
};

async function loadOffers(ids: (string | null)[]): Promise<Map<string, Offer>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const offers = new Map<string, Offer>();
  for (let i = 0; i < unique.length; i += 100) {
    const keys = unique.slice(i, i + 100).map((id) => ({ pk: `OFFER#${id}`, sk: 'OFFER' }));
    const response = await ddb.send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys } } }));
    for (const item of response.Responses?.[TABLE_NAME] ?? []) {
      const offer = OfferSchema.parse(item);
      offers.set(offer.id, offer);
    }
  }
  return offers;
}
