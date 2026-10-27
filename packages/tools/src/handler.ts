import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { PlanRepo } from '@dinner/workflow/plans';
import { HouseholdIdSchema, OfferSchema, householdKeys, resolveWeekKey, type Offer } from '@dinner/shared';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { TOOLS, type ToolName } from './definitions.js';
import { MealHistoryRepo } from './history.js';
import { NutritionDb, type FridaFood } from './nutrition.js';
import { OfferCatalog } from './offers.js';
import { perServing, removeDinner, replaceDinner } from './plan-edits.js';
import { PreferencesRepo } from './preferences.js';
import fridaFoods from '../data/frida-foods.json' with { type: 'json' };

const env = z
  .object({
    TABLE_NAME: z.string(),
    BUCKET_NAME: z.string(),
    STATE_MACHINE_ARN: z.string(),
    IMAGE_FUNCTION_NAME: z.string(),
  })
  .parse(process.env);

const logger = new Logger({ serviceName: 'tools' });
const tracer = new Tracer({ serviceName: 'tools' });

const ddb = DynamoDBDocumentClient.from(tracer.captureAWSv3Client(new DynamoDBClient({})), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = tracer.captureAWSv3Client(new S3Client({}));

const catalog = new OfferCatalog(s3, env.BUCKET_NAME);
const nutrition = new NutritionDb(fridaFoods as FridaFood[]);
const preferences = new PreferencesRepo(ddb, env.TABLE_NAME);
const history = new MealHistoryRepo(ddb, env.TABLE_NAME);
const plans = new PlanRepo(ddb, env.TABLE_NAME);
const lambda = tracer.captureAWSv3Client(new LambdaClient({}));
const sfn = tracer.captureAWSv3Client(new SFNClient({}));

/** Set by the Gateway request interceptor from a trusted header; never by the model. */
const Injected = z.object({ householdId: HouseholdIdSchema });

const TOOL_PREFIX_DELIMITER = '___';

export const handler = async (event: Record<string, unknown>, context: Context) => {
  logger.addContext(context);
  const fullName = toolNameFrom(context);
  const toolName = fullName.slice(fullName.indexOf(TOOL_PREFIX_DELIMITER) + TOOL_PREFIX_DELIMITER.length) as ToolName;

  try {
    if (!(toolName in TOOLS)) throw new Error(`Unknown tool: ${fullName}`);
    const { householdId } = Injected.parse(event);
    const input = TOOLS[toolName].input.parse(event);
    logger.info('Tool call', { toolName, householdId });
    return await run(toolName, householdId, input);
  } catch (error) {
    const message = error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : String(error);
    logger.warn('Tool call failed', { toolName, message });
    return { error: message };
  }
};

/** Gateway puts `<target>___<tool>` into the client context; the Node runtime exposes it as `Custom`. */
function toolNameFrom(context: Context): string {
  const custom = (context.clientContext as { Custom?: Record<string, unknown>; custom?: Record<string, unknown> } | undefined);
  return String((custom?.Custom ?? custom?.custom)?.bedrockAgentCoreToolName ?? '');
}

async function run(toolName: ToolName, householdId: string, input: unknown) {
  switch (toolName) {
    case 'search_offers':
      return catalog.search(TOOLS.search_offers.input.parse(input));
    case 'get_offer': {
      const { offerId } = TOOLS.get_offer.input.parse(input);
      const { Item } = await ddb.send(
        new GetCommand({ TableName: env.TABLE_NAME, Key: { pk: `OFFER#${offerId}`, sk: 'OFFER' } }),
      );
      if (!Item) throw new Error(`No offer with id ${offerId}`);
      return OfferSchema.parse(Item);
    }
    case 'nutrition_lookup':
      return nutrition.lookup(TOOLS.nutrition_lookup.input.parse(input).items);
    case 'get_preferences':
      return preferences.get(householdId);
    case 'update_preferences':
      return preferences.update(householdId, TOOLS.update_preferences.input.parse(input));
    case 'get_meal_history': {
      const { weeks = 8 } = TOOLS.get_meal_history.input.parse(input);
      return { meals: await history.list(householdId, weeks) };
    }
    case 'get_plan': {
      const week = resolveWeekKey(TOOLS.get_plan.input.parse(input).week, new Date());
      const plan = await plans.get(householdId, week);
      if (!plan) return { week, plan: null, message: `No plan has been made for ${week} yet.` };
      const { usage: _usage, models: _models, checks: _checks, executionId: _executionId, ...visible } = plan;
      // Weekday names spare the model from date arithmetic.
      return { ...visible, dinners: visible.dinners.map((d) => ({ day: weekday(d.date), ...d })) };
    }
    case 'replace_dinner': {
      const { week, date, dinner } = TOOLS.replace_dinner.input.parse(input);
      const plan = await requirePlan(householdId, week);
      const draft = { ...dinner, date };
      const prefs = await preferences.get(householdId);
      const lookup = nutrition.lookup(draft.ingredients.map((i) => ({ ingredient: i.name, grams: i.grams })));
      const offers = await loadOffers([...plan.dinners.filter((d) => d.date !== date), draft]);
      const result = replaceDinner(plan, draft, {
        preferences: prefs,
        offers,
        nutrition: perServing(lookup.total, lookup.unmatched, prefs.settings.servings),
        now: new Date(),
      });
      await plans.put(result.plan);
      await plans.syncMealHistory(result.plan);
      await requestImage(householdId, plan.week, draft);
      return { saved: true, dinner: result.plan.dinners.find((d) => d.date === date), warnings: result.warnings };
    }
    case 'remove_dinner': {
      const { week, date } = TOOLS.remove_dinner.input.parse(input);
      const plan = await requirePlan(householdId, week);
      const updated = removeDinner(plan, date, await loadOffers(plan.dinners), new Date());
      await plans.put(updated);
      await plans.syncMealHistory(updated);
      return { removed: date, remainingDinners: updated.dinners.map((d) => `${d.date}: ${d.dish}`) };
    }
    case 'rate_meal': {
      const { date, rating } = TOOLS.rate_meal.input.parse(input);
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: env.TABLE_NAME,
            Key: householdKeys.meal(householdId, date),
            UpdateExpression: 'SET rating = :rating',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeValues: { ':rating': rating },
          }),
        );
      } catch (error) {
        if ((error as Error).name === 'ConditionalCheckFailedException') throw new Error(`No dinner is recorded on ${date}.`);
        throw error;
      }
      return { date, rating };
    }
    case 'replan_week': {
      const { week, reason } = TOOLS.replan_week.input.parse(input);
      const weekKey = resolveWeekKey(week, new Date());
      const execution = await sfn.send(
        new StartExecutionCommand({
          stateMachineArn: env.STATE_MACHINE_ARN,
          name: `chat-${weekKey}-${Date.now()}`,
          input: JSON.stringify({ householdId, week: weekKey, skipFetch: true }),
        }),
      );
      logger.info('Re-plan started', { householdId, weekKey, reason, executionArn: execution.executionArn });
      return { started: true, week: weekKey, message: 'A new plan is being made; it arrives by email in about 3-5 minutes.' };
    }
  }
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

async function requirePlan(householdId: string, week: string | undefined) {
  const weekKey = resolveWeekKey(week, new Date());
  const plan = await plans.get(householdId, weekKey);
  if (!plan) throw new Error(`No plan exists for ${weekKey}; use replan_week to create one.`);
  return plan;
}

async function loadOffers(dinners: { ingredients: { offerId: string | null }[] }[]): Promise<Map<string, Offer>> {
  const ids = [...new Set(dinners.flatMap((d) => d.ingredients.map((i) => i.offerId)).filter((id): id is string => !!id))];
  const offers = new Map<string, Offer>();
  for (let i = 0; i < ids.length; i += 100) {
    const keys = ids.slice(i, i + 100).map((id) => ({ pk: `OFFER#${id}`, sk: 'OFFER' }));
    const response = await ddb.send(new BatchGetCommand({ RequestItems: { [env.TABLE_NAME]: { Keys: keys } } }));
    for (const item of response.Responses?.[env.TABLE_NAME] ?? []) {
      const offer = OfferSchema.parse(item);
      offers.set(offer.id, offer);
    }
  }
  return offers;
}

/** Generates the new dinner's photo in the background; the image Lambda attaches it to the plan. */
async function requestImage(householdId: string, week: string, dinner: { date: string; dish: string; description: string; cuisine: string }) {
  await lambda.send(
    new InvokeCommand({
      FunctionName: env.IMAGE_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(
        JSON.stringify({ householdId, week, attach: true, dinner: { date: dinner.date, dish: dinner.dish, description: dinner.description, cuisine: dinner.cuisine } }),
      ),
    }),
  );
}
