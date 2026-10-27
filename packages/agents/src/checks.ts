import type { DinnerDraft, Issue, MealPlanDraft, MealRecord, Nutrition, Preferences } from '@dinner/shared';

/**
 * Words that indicate an allergen in an ingredient or dish name (EU major allergens).
 * Each term matches at the start of a word, so "nut" does not match "coconut" or "butternut".
 */
const ALLERGEN_TERMS: Record<string, string[]> = {
  nuts: ['nuts?\\b', 'almond', 'hazelnut', 'walnut', 'cashew', 'pecan', 'pistachio', 'macadamia', 'pine nut'],
  'tree nuts': ['almond', 'hazelnut', 'walnut', 'cashew', 'pecan', 'pistachio', 'macadamia'],
  peanuts: ['peanut', 'satay'],
  gluten: ['wheat', 'flour', 'pasta', 'spaghetti', 'noodle', 'bread', 'couscous', 'bulgur', 'barley', 'rye', 'tortilla', 'breadcrumb', 'panko', 'soy sauce'],
  wheat: ['wheat', 'flour', 'pasta', 'spaghetti', 'noodle', 'bread', 'couscous', 'bulgur', 'tortilla', 'breadcrumb', 'panko'],
  shellfish: ['shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'langoustine', 'mussel', 'clam', 'oyster', 'scallop', 'squid'],
  crustaceans: ['shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'langoustine'],
  molluscs: ['mussel', 'clam', 'oyster', 'scallop', 'squid', 'octopus'],
  fish: ['fish', 'salmon', 'cod', 'tuna', 'mackerel', 'herring', 'trout', 'plaice', 'pollock', 'haddock', 'anchov', 'sardine'],
  milk: ['milk', 'cream', 'butter', 'cheese', 'yoghurt', 'yogurt', 'feta', 'parmesan', 'mozzarella', 'skyr', 'crème fraîche', 'creme fraiche'],
  dairy: ['milk', 'cream', 'butter', 'cheese', 'yoghurt', 'yogurt', 'feta', 'parmesan', 'mozzarella', 'skyr', 'crème fraîche', 'creme fraiche'],
  lactose: ['milk', 'cream', 'cheese', 'yoghurt', 'yogurt', 'skyr'],
  eggs: ['egg', 'mayonnaise', 'aioli'],
  soy: ['soy', 'soya', 'tofu', 'edamame', 'tempeh', 'miso'],
  sesame: ['sesame', 'tahini'],
  celery: ['celery', 'celeriac'],
  mustard: ['mustard'],
};

export const NUTRITION_LIMITS = {
  kcalMin: 400,
  kcalMax: 1000,
  proteinMin: 20,
  saltMax: 3.5,
};

/** Recent dishes are not repeated within this many days. */
export const NO_REPEAT_DAYS = 28;

export interface CheckContext {
  week: { key: string; dates: string[] };
  preferences: Preferences;
  history: MealRecord[];
  /** Offer validity by id; missing ids are unknown offers. */
  offers: Map<string, { validFrom: string; validTo: string; everydayPrice: boolean }>;
  /** Nutrition per serving by dinner date. */
  nutrition: Map<string, Nutrition>;
  /** Weekdays in the plan (YYYY-MM-DD) that count as weekdays for cooking-time limits. */
  weekdays: Set<string>;
}

export function checkPlan(plan: MealPlanDraft, ctx: CheckContext): Issue[] {
  return [
    ...checkStructure(plan, ctx),
    ...plan.dinners.flatMap((d) => checkAllergens(d, ctx.preferences)),
    ...plan.dinners.flatMap((d) => checkDislikes(d, ctx.preferences)),
    ...checkRepetition(plan, ctx.history),
    ...plan.dinners.flatMap((d) => checkOffers(d, ctx)),
    ...plan.dinners.flatMap((d) => checkNutrition(d, ctx.nutrition.get(d.date))),
    ...plan.dinners.flatMap((d) => checkCookingTime(d, ctx)),
  ];
}

export const hasBlocking = (issues: Issue[]) => issues.some((i) => i.severity === 'blocking');

function checkStructure(plan: MealPlanDraft, ctx: CheckContext): Issue[] {
  const issues: Issue[] = [];
  const wanted = ctx.preferences.settings.dinnersPerWeek;
  if (plan.dinners.length !== wanted) {
    issues.push(blocking(null, `The plan has ${plan.dinners.length} dinners but the household wants ${wanted}.`));
  }
  const seen = new Set<string>();
  for (const dinner of plan.dinners) {
    if (!ctx.week.dates.includes(dinner.date)) {
      issues.push(blocking(dinner.date, `${dinner.date} is not in week ${ctx.week.key} (${ctx.week.dates[0]} to ${ctx.week.dates.at(-1)}).`));
    }
    if (seen.has(dinner.date)) issues.push(blocking(dinner.date, `Two dinners are planned on ${dinner.date}.`));
    seen.add(dinner.date);
  }
  return issues;
}

function checkAllergens(dinner: DinnerDraft, preferences: Preferences): Issue[] {
  const issues: Issue[] = [];
  const texts = [dinner.dish, ...dinner.ingredients.map((i) => i.name)].map((t) => t.toLowerCase());
  for (const member of preferences.members) {
    for (const allergy of member.allergies) {
      const key = allergy.trim().toLowerCase();
      const patterns = (ALLERGEN_TERMS[key] ?? [escape(singular(key))]).map((term) => new RegExp(`\\b${term}`));
      const hit = texts.find((t) => patterns.some((p) => p.test(t)));
      if (hit) {
        issues.push(blocking(dinner.date, `"${hit}" conflicts with ${member.name}'s ${allergy} allergy.`));
      }
    }
  }
  return issues;
}

function checkDislikes(dinner: DinnerDraft, preferences: Preferences): Issue[] {
  const texts = [dinner.dish, ...dinner.ingredients.map((i) => i.name)].map((t) => t.toLowerCase());
  return preferences.members.flatMap((member) =>
    member.dislikes
      .filter((dislike) => texts.some((t) => t.includes(singular(dislike.toLowerCase()))))
      .map((dislike) => major(dinner.date, `${member.name} dislikes ${dislike}.`)),
  );
}

function checkRepetition(plan: MealPlanDraft, history: MealRecord[]): Issue[] {
  const issues: Issue[] = [];

  const dishes = new Map<string, string>();
  const proteins = new Map<string, number>();
  for (const dinner of plan.dinners) {
    const dish = normalize(dinner.dish);
    const previous = dishes.get(dish);
    if (previous) issues.push(blocking(dinner.date, `"${dinner.dish}" is also planned on ${previous}.`));
    dishes.set(dish, dinner.date);

    const protein = normalize(dinner.mainProtein);
    proteins.set(protein, (proteins.get(protein) ?? 0) + 1);
  }
  for (const [protein, count] of proteins) {
    if (count > 2) issues.push(major(null, `${protein} is the main protein in ${count} dinners; use it at most twice.`));
  }

  const firstDate = plan.dinners.map((d) => d.date).sort()[0];
  if (firstDate) {
    const cutoff = addDays(firstDate, -NO_REPEAT_DAYS);
    const recent = history.filter((m) => m.date >= cutoff && m.date < firstDate);
    for (const dinner of plan.dinners) {
      const match = recent.find((m) => normalize(m.dish) === normalize(dinner.dish));
      if (match) issues.push(major(dinner.date, `"${dinner.dish}" was already served on ${match.date}.`));
      const disliked = history.find((m) => m.rating === 'down' && normalize(m.dish) === normalize(dinner.dish));
      if (disliked) issues.push(blocking(dinner.date, `"${dinner.dish}" was rated thumbs down on ${disliked.date}.`));
    }
  }
  return issues;
}

function checkOffers(dinner: DinnerDraft, ctx: CheckContext): Issue[] {
  const issues: Issue[] = [];
  const offerIds = dinner.ingredients.map((i) => i.offerId).filter((id): id is string => !!id);
  if (offerIds.length === 0) {
    issues.push(major(dinner.date, 'No ingredient is bought on offer; build the dinner around at least one current deal.'));
  }
  const known = offerIds.map((id) => ctx.offers.get(id)).filter((o) => o !== undefined);
  if (known.length > 0 && known.every((o) => o.everydayPrice)) {
    issues.push(minor(dinner.date, 'Only everyday prices are used; prefer at least one of this week\'s real deals if one fits.'));
  }
  const dayStart = `${dinner.date}T00:00:00`;
  for (const id of offerIds) {
    const offer = ctx.offers.get(id);
    if (!offer) {
      issues.push(blocking(dinner.date, `Offer ${id} does not exist; only use ids returned by search_offers.`));
    } else if (offer.validTo < dayStart) {
      // Offers can be bought ahead, so only an offer that ends before the week starts is a hard error.
      const severity = offer.validTo < `${ctx.week.dates[0]}T00:00:00` ? blocking : minor;
      issues.push(severity(dinner.date, `Offer ${id} ends ${offer.validTo.slice(0, 10)}, before ${dinner.date}; buy it earlier or pick another.`));
    }
  }
  return issues;
}

function checkNutrition(dinner: DinnerDraft, nutrition: Nutrition | undefined): Issue[] {
  if (!nutrition) return [major(dinner.date, 'Nutrition could not be computed.')];
  const issues: Issue[] = [];
  const { kcalMin, kcalMax, proteinMin, saltMax } = NUTRITION_LIMITS;
  if (nutrition.kcal < kcalMin || nutrition.kcal > kcalMax) {
    issues.push(major(dinner.date, `${nutrition.kcal} kcal per serving is outside ${kcalMin}-${kcalMax}; adjust portions.`));
  }
  if (nutrition.protein < proteinMin) {
    issues.push(major(dinner.date, `${nutrition.protein} g protein per serving is below ${proteinMin} g.`));
  }
  if (nutrition.salt > saltMax) issues.push(minor(dinner.date, `${nutrition.salt} g salt per serving is high.`));
  if (nutrition.unmatched.length > 0) {
    issues.push(minor(dinner.date, `No nutrition data for: ${nutrition.unmatched.join(', ')}. Use plainer ingredient names.`));
  }
  return issues;
}

function checkCookingTime(dinner: DinnerDraft, ctx: CheckContext): Issue[] {
  const max = ctx.preferences.settings.maxWeekdayCookingMinutes;
  if (ctx.weekdays.has(dinner.date) && dinner.cookingMinutes > max) {
    return [major(dinner.date, `${dinner.cookingMinutes} minutes is over the ${max}-minute weekday limit.`)];
  }
  return [];
}

const issue = (severity: Issue['severity']) => (date: string | null, message: string): Issue => ({ date, severity, message });
const blocking = issue('blocking');
const major = issue('major');
const minor = issue('minor');

const normalize = (s: string) => s.toLowerCase().replace(/[^a-zæøå0-9]+/g, ' ').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const singular = (s: string) => (s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
