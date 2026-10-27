import {
  buildShoppingList,
  checkAllergens,
  checkDislikes,
  isoWeekDates,
  type DinnerDraft,
  type Nutrition,
  type Offer,
  type Preferences,
  type StoredPlan,
} from '@dinner/shared';

type StoredDinner = StoredPlan['dinners'][number];

export interface ReplaceContext {
  preferences: Preferences;
  /** Offers referenced by the whole plan after the change, by id. */
  offers: Map<string, Offer>;
  nutrition: Nutrition;
  now: Date;
}

/** Applies a dinner replacement to a stored plan. Throws on allergens or unknown offers; returns warnings otherwise. */
export function replaceDinner(plan: StoredPlan, draft: DinnerDraft, ctx: ReplaceContext): { plan: StoredPlan; warnings: string[] } {
  if (!isoWeekDates(plan.week).includes(draft.date)) {
    throw new Error(`${draft.date} is not in week ${plan.week}.`);
  }

  const allergens = checkAllergens(draft, ctx.preferences);
  if (allergens.length > 0) {
    throw new Error(`Not saved: ${allergens.map((i) => i.message).join(' ')}`);
  }

  const warnings = checkDislikes(draft, ctx.preferences).map((i) => i.message);
  for (const ingredient of draft.ingredients) {
    if (!ingredient.offerId) continue;
    const offer = ctx.offers.get(ingredient.offerId);
    if (!offer) throw new Error(`Not saved: offer ${ingredient.offerId} does not exist; use ids from search_offers.`);
    if (offer.validTo < `${draft.date}T00:00:00`) {
      warnings.push(`The ${ingredient.name} offer ends ${offer.validTo.slice(0, 10)}, so buy it before then.`);
    }
  }
  if (ctx.nutrition.unmatched.length) warnings.push(`No nutrition data for: ${ctx.nutrition.unmatched.join(', ')}.`);

  const dinner: StoredDinner = {
    ...draft,
    servings: ctx.preferences.settings.servings,
    nutrition: ctx.nutrition,
    imageUrl: null,
  };
  const dinners = [...plan.dinners.filter((d) => d.date !== draft.date), dinner].sort((a, b) => a.date.localeCompare(b.date));
  return { plan: withDinners(plan, dinners, ctx.offers, ctx.now), warnings };
}

export function removeDinner(plan: StoredPlan, date: string, offers: Map<string, Offer>, now: Date): StoredPlan {
  if (!plan.dinners.some((d) => d.date === date)) throw new Error(`There is no dinner on ${date} in week ${plan.week}.`);
  return withDinners(plan, plan.dinners.filter((d) => d.date !== date), offers, now);
}

function withDinners(plan: StoredPlan, dinners: StoredDinner[], offers: Map<string, Offer>, now: Date): StoredPlan {
  return { ...plan, dinners, shoppingList: buildShoppingList(dinners, offers), updatedAt: now.toISOString() };
}

/** Per-serving nutrition from recipe totals. */
export function perServing(total: Omit<Nutrition, 'unmatched'>, unmatched: string[], servings: number): Nutrition {
  const values = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, Math.round((v / servings) * 10) / 10]));
  return { ...(values as Omit<Nutrition, 'unmatched'>), kcal: Math.round(total.kcal / servings), unmatched };
}
