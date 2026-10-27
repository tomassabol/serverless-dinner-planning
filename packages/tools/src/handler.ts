import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { HouseholdIdSchema, OfferSchema } from '@dinner/shared';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { TOOLS, type ToolName } from './definitions.js';
import { MealHistoryRepo } from './history.js';
import { NutritionDb, type FridaFood } from './nutrition.js';
import { OfferCatalog } from './offers.js';
import { PreferencesRepo } from './preferences.js';
import fridaFoods from '../data/frida-foods.json' with { type: 'json' };

const env = z.object({ TABLE_NAME: z.string(), BUCKET_NAME: z.string() }).parse(process.env);

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
  }
}
