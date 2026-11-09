import { z } from 'zod';
import { ChainIdSchema } from './chains.js';
import { CountrySchema } from './countries.js';

/** Household IDs come from Cognito (`custom:householdId`) and are injected by the Gateway interceptor. */
export const HouseholdIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

export const MemberSchema = z.object({
  name: z.string().min(1),
  /** Hard constraints: a plan containing these is rejected. */
  allergies: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
  likes: z.array(z.string()).default([]),
  /** Free text such as "pescetarian" or "no pork". */
  diet: z.string().nullable().default(null),
});
export type Member = z.infer<typeof MemberSchema>;

export const PlanSettingsSchema = z.object({
  dinnersPerWeek: z.number().int().min(1).max(7).default(5),
  servings: z.number().int().min(1).max(12).default(2),
  maxWeekdayCookingMinutes: z.number().int().min(10).max(240).default(45),
  /** Empty means every ingested chain. */
  preferredChains: z.array(ChainIdSchema).default([]),
  /** In the household's currency (DKK or SEK). */
  weeklyBudget: z.number().positive().nullable().default(null),
});
export type PlanSettings = z.infer<typeof PlanSettingsSchema>;

export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Human-readable place, e.g. "Göteborg". */
  label: z.string().min(1).max(80),
});
export type Location = z.infer<typeof LocationSchema>;

/**
 * Where the household shops. Danish offers are national; Swedish chains publish a flyer per store,
 * so a Swedish household needs a location (the nearest store of each chain is used).
 * Changed in the web app's settings, never by the agents.
 */
export const MarketSchema = z.object({
  country: CountrySchema.default('DK'),
  location: LocationSchema.nullable().default(null),
});
export type Market = z.infer<typeof MarketSchema>;

export const PreferencesSchema = z.object({
  householdId: HouseholdIdSchema,
  market: MarketSchema.default(MarketSchema.parse({})),
  members: z.array(MemberSchema).default([]),
  settings: PlanSettingsSchema.default(PlanSettingsSchema.parse({})),
  notes: z.array(z.string()).default([]),
  updatedAt: z.iso.datetime().nullable().default(null),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/** One cooked (or planned) dinner, used to avoid repetition. */
export const MealRecordSchema = z.object({
  date: z.iso.date(),
  dish: z.string(),
  mainProtein: z.string().nullable(),
  cuisine: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  rating: z.enum(['up', 'down']).nullable().default(null),
});
export type MealRecord = z.infer<typeof MealRecordSchema>;

/** Renames fields stored before Sweden was supported (`weeklyBudgetDkk` became `weeklyBudget`). */
export function migratePreferences(item: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const settings = item?.settings as Record<string, unknown> | undefined;
  if (!item || !settings || !('weeklyBudgetDkk' in settings)) return item;
  const { weeklyBudgetDkk, ...rest } = settings;
  return { ...item, settings: { weeklyBudget: weeklyBudgetDkk, ...rest } };
}

export const householdKeys = {
  preferences: (householdId: string) => ({ pk: `HOUSEHOLD#${householdId}`, sk: 'PREFERENCES' }),
  meal: (householdId: string, date: string) => ({ pk: `HOUSEHOLD#${householdId}`, sk: `MEAL#${date}` }),
  plan: (householdId: string, week: string) => ({ pk: `HOUSEHOLD#${householdId}`, sk: `PLAN#${week}` }),
};

/** GSI keys on the preferences item, so every household with saved preferences can be listed (ingest uses it). */
export const householdIndexKeys = (householdId: string) => ({ gsi1pk: 'HOUSEHOLDS', gsi1sk: householdId });
