import { z } from 'zod';
import { ChainIdSchema, DinnerDraftSchema, OfferCategorySchema, PlanSettingsSchema } from '@dinner/shared';

const WeekSchema = z
  .string()
  .regex(/^(current|next|\d{4}-W\d{2})$/)
  .describe('Which ISO week: "current", "next" or an ISO week like "2026-W45". Defaults to "current".');

export const SearchOffersInput = z.object({
  query: z
    .string()
    .optional()
    .describe('Ingredient or product to look for, in English or Danish (e.g. "salmon", "kyllingebryst"). Omit to browse.'),
  categories: z.array(OfferCategorySchema).optional().describe('Only return offers in these categories.'),
  chains: z.array(ChainIdSchema).optional().describe('Only return offers from these chains.'),
  week: WeekSchema.optional(),
  validOn: z.iso.date().optional().describe('Only offers valid on this date (YYYY-MM-DD, Danish time).'),
  dinnerRelevantOnly: z.boolean().optional().describe('Skip snacks, drinks and other non-dinner items. Defaults to true.'),
  limit: z.number().int().min(1).max(50).optional().describe('Maximum number of offers to return. Defaults to 20.'),
});

export const GetOfferInput = z.object({
  offerId: z.string().describe('Offer id as returned by search_offers.'),
});

export const NutritionLookupInput = z.object({
  items: z
    .array(
      z.object({
        ingredient: z.string().describe('Plain English ingredient name, e.g. "chicken breast", "rice", "olive oil".'),
        grams: z.number().positive().describe('Raw weight in grams for the whole recipe.'),
      }),
    )
    .min(1)
    .max(40)
    .describe('Every ingredient of one recipe with its raw weight.'),
});

export const GetPreferencesInput = z.object({});

export const UpdatePreferencesInput = z.object({
  member: z
    .string()
    .optional()
    .describe('Household member the change applies to (first name). Required for allergies, dislikes, likes and diet.'),
  addAllergies: z.array(z.string()).optional(),
  removeAllergies: z.array(z.string()).optional(),
  addDislikes: z.array(z.string()).optional(),
  removeDislikes: z.array(z.string()).optional(),
  addLikes: z.array(z.string()).optional(),
  removeLikes: z.array(z.string()).optional(),
  diet: z.string().nullable().optional().describe('Diet description such as "pescetarian"; null clears it.'),
  settings: PlanSettingsSchema.partial().optional().describe('Planning settings to change.'),
  addNotes: z.array(z.string()).optional().describe('Household-wide notes, e.g. "We cook bigger portions on Sundays".'),
  removeNotes: z.array(z.string()).optional(),
});

export const GetMealHistoryInput = z.object({
  weeks: z.number().int().min(1).max(26).optional().describe('How many weeks back to look. Defaults to 8.'),
});

export const GetPlanInput = z.object({ week: WeekSchema.optional() });

export const ReplaceDinnerInput = z.object({
  week: WeekSchema.optional(),
  date: z.iso.date().describe('Date of the dinner to replace or add, YYYY-MM-DD, within the week.'),
  dinner: DinnerDraftSchema.omit({ date: true }).describe('The new dinner. Same rules as the weekly plan: plain English ingredient names, raw grams for all servings, offerId from search_offers or null.'),
});

export const RemoveDinnerInput = z.object({
  week: WeekSchema.optional(),
  date: z.iso.date().describe('Date of the dinner to remove, YYYY-MM-DD.'),
});

export const RateMealInput = z.object({
  date: z.iso.date().describe('Date of the dinner, YYYY-MM-DD.'),
  rating: z.enum(['up', 'down']).describe('"up" if they liked it, "down" if they did not. Thumbs-down dishes are never planned again.'),
});

export const ReplanWeekInput = z.object({
  week: WeekSchema.optional(),
  reason: z.string().optional().describe('Why the household wants a new plan, for the log.'),
});

export const TOOLS = {
  search_offers: {
    description:
      'Search this week\'s or next week\'s supermarket offers (Netto, Lidl, REMA 1000, føtex, Bilka, 365discount, SuperBrugsen, Brugsen, Kvickly, SPAR, MENY). Returns price, price per kg/l/piece, validity dates and an ingredient tag. "everydayPrice" marks permanent low prices rather than weekly deals.',
    input: SearchOffersInput,
  },
  get_offer: {
    description: 'Get full details of one offer, including its product image URL.',
    input: GetOfferInput,
  },
  nutrition_lookup: {
    description:
      'Compute nutrition for a recipe from the Danish Frida food database. Pass every ingredient with its raw weight; returns per-ingredient matches and totals (kcal, protein, fat, saturated fat, carbs, sugars, fiber, salt). Check "unmatched" and low-confidence matches.',
    input: NutritionLookupInput,
  },
  get_preferences: {
    description:
      "Get the household's members with allergies, dislikes, likes and diets, plus planning settings (dinners per week, servings, cooking time, preferred chains, budget).",
    input: GetPreferencesInput,
  },
  update_preferences: {
    description:
      "Change the household's preferences: allergies, dislikes, likes or diet for a member, planning settings, or household notes. Only call this when the user explicitly asks for a change.",
    input: UpdatePreferencesInput,
  },
  get_meal_history: {
    description: 'List recently planned or cooked dinners with ratings, to avoid repeating dishes and main proteins.',
    input: GetMealHistoryInput,
  },
  get_plan: {
    description:
      "Get the household's stored dinner plan for a week: every dinner with ingredients, recipe steps, nutrition per serving and photo, plus the shopping list grouped by store.",
    input: GetPlanInput,
  },
  replace_dinner: {
    description:
      'Replace (or add) one dinner in the stored plan. Checks allergies, recomputes nutrition and the shopping list, updates the meal history and generates a new photo in the background. Only call this when the user asks for a change.',
    input: ReplaceDinnerInput,
  },
  remove_dinner: {
    description: 'Remove one dinner from the stored plan and update the shopping list. Only call this when the user asks.',
    input: RemoveDinnerInput,
  },
  rate_meal: {
    description: 'Record whether the household liked a dinner they had. Use when the user gives feedback about a meal.',
    input: RateMealInput,
  },
  replan_week: {
    description:
      'Start a completely new weekly plan in the background with the current offers (no new offer fetch). Takes about 3-5 minutes; the household gets the new plan by email. Only call this when the user explicitly wants a fresh plan.',
    input: ReplanWeekInput,
  },
} as const;

export type ToolName = keyof typeof TOOLS;

/** Tools that change data; the interceptor only allows them for the chat agent. */
export const WRITE_TOOLS: ReadonlySet<ToolName> = new Set([
  'update_preferences',
  'replace_dinner',
  'remove_dinner',
  'rate_meal',
  'replan_week',
]);

type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  [key: string]: unknown;
};

/**
 * AgentCore Gateway accepts a subset of JSON Schema (type, description, properties, required, items).
 * Enums and nullable types are folded into the description.
 */
export function toGatewaySchema(schema: JsonSchema): JsonSchema {
  if (schema.anyOf) {
    const nonNull = schema.anyOf.find((s) => s.type !== 'null') ?? {};
    const nullable = schema.anyOf.some((s) => s.type === 'null');
    const inner = toGatewaySchema({ ...nonNull, description: schema.description ?? nonNull.description });
    return nullable ? { ...inner, description: join(inner.description, 'May be null.') } : inner;
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const result: JsonSchema = { type: types.find((t) => t !== 'null') };
  let description = schema.description;
  if (types.includes('null')) description = join(description, 'May be null.');
  if (schema.enum) description = join(description, `One of: ${schema.enum.join(', ')}.`);
  if (description) result.description = description;
  if (schema.properties) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGatewaySchema(value)]),
    );
    if (schema.required?.length) result.required = schema.required;
  }
  if (schema.items) result.items = toGatewaySchema(schema.items);
  return result;
}

const join = (a: string | undefined, b: string) => (a ? `${a} ${b}` : b);

export function gatewayToolSchema() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: toGatewaySchema(z.toJSONSchema(tool.input, { io: 'input' }) as JsonSchema),
  }));
}
