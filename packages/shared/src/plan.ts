import { z } from 'zod';

export const PlannedIngredientSchema = z.object({
  name: z.string().describe('Plain English ingredient name, e.g. "chicken breast", "rice", "olive oil".'),
  grams: z.number().positive().describe('Raw weight in grams for the whole recipe (all servings).'),
  offerId: z.string().nullable().describe('Id of the supermarket offer this ingredient is bought from, or null.'),
});
export type PlannedIngredient = z.infer<typeof PlannedIngredientSchema>;

export const DinnerDraftSchema = z.object({
  date: z.iso.date().describe('Date of the dinner, YYYY-MM-DD.'),
  dish: z.string().describe('Short dish name, e.g. "Lemon-garlic salmon with roast potatoes".'),
  description: z.string().describe('One or two appetising sentences.'),
  cuisine: z.string().describe('e.g. "Danish", "Italian", "Thai".'),
  mainProtein: z.string().describe('Main protein in plain English, e.g. "salmon", "chicken", "lentils".'),
  cookingMinutes: z.number().int().positive(),
  ingredients: z.array(PlannedIngredientSchema).min(2),
  steps: z.array(z.string()).min(2).describe('Short recipe steps.'),
  estimatedCostDkk: z.number().nonnegative().describe('Estimated cost of all ingredients in DKK.'),
});
export type DinnerDraft = z.infer<typeof DinnerDraftSchema>;

export const MealPlanDraftSchema = z.object({
  dinners: z.array(DinnerDraftSchema).min(1),
  notes: z.string().describe('One or two sentences on how the week fits together (variety, leftovers, budget).'),
});
export type MealPlanDraft = z.infer<typeof MealPlanDraftSchema>;

/** Nutrition per serving, computed from Frida by code, never by the model. */
export const NutritionSchema = z.object({
  kcal: z.number(),
  protein: z.number(),
  fat: z.number(),
  saturatedFat: z.number(),
  carbs: z.number(),
  sugars: z.number(),
  fiber: z.number(),
  salt: z.number(),
  unmatched: z.array(z.string()),
});
export type Nutrition = z.infer<typeof NutritionSchema>;

export const IssueSchema = z.object({
  date: z.iso.date().nullable().describe('The dinner the issue is about, or null for the whole plan.'),
  severity: z.enum(['blocking', 'major', 'minor']),
  message: z.string(),
});
export type Issue = z.infer<typeof IssueSchema>;

export const JudgeVerdictSchema = z.object({
  score: z.number().min(0).max(10).describe('Overall quality from 0 to 10.'),
  approved: z.boolean().describe('True only if the plan can be sent to the household as is.'),
  summary: z
    .string()
    .describe('Two or three sentences to the household describing the week. Do not mention problems; those go in issues.'),
  issues: z.array(IssueSchema),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export const DinnerSchema = DinnerDraftSchema.extend({
  servings: z.number().int().positive(),
  nutrition: NutritionSchema,
});
export type Dinner = z.infer<typeof DinnerSchema>;

export const MealPlanSchema = z.object({
  householdId: z.string(),
  week: z.string(),
  status: z.enum(['approved', 'best_effort']),
  dinners: z.array(DinnerSchema),
  notes: z.string(),
  verdict: JudgeVerdictSchema,
  checks: z.array(IssueSchema),
  rounds: z.number().int(),
  models: z.object({ planner: z.string(), judge: z.string() }),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadInputTokens: z.number(),
    cacheWriteInputTokens: z.number(),
  }),
  generatedAt: z.iso.datetime(),
});
export type MealPlan = z.infer<typeof MealPlanSchema>;

export const ShoppingOfferItemSchema = z.object({
  offerId: z.string(),
  heading: z.string(),
  ingredient: z.string(),
  price: z.number(),
  prePrice: z.number().nullable(),
  validTo: z.string(),
  forDinners: z.array(z.iso.date()),
});

export const ShoppingListSchema = z.object({
  stores: z.array(
    z.object({
      chain: z.string(),
      chainName: z.string(),
      items: z.array(ShoppingOfferItemSchema),
      subtotal: z.number(),
    }),
  ),
  /** Ingredients not bought on offer, summed across dinners. */
  other: z.array(z.object({ name: z.string(), grams: z.number(), forDinners: z.array(z.iso.date()) })),
  offerTotal: z.number(),
});
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

/** The plan as stored in DynamoDB and shown in the email and app. */
export const StoredPlanSchema = MealPlanSchema.extend({
  dinners: z.array(DinnerSchema.extend({ imageUrl: z.string().nullable() })),
  shoppingList: ShoppingListSchema,
  state: z.enum(['generating_images', 'ready']),
  executionId: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type StoredPlan = z.infer<typeof StoredPlanSchema>;
