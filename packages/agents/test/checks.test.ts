import { describe, expect, it } from 'vitest';
import { PreferencesSchema, type DinnerDraft, type MealPlanDraft, type Nutrition } from '@dinner/shared';
import { checkPlan, hasBlocking, type CheckContext } from '../src/checks.js';

const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];

const dinner = (date: string, dish: string, mainProtein: string, extra: Partial<DinnerDraft> = {}): DinnerDraft => ({
  date,
  dish,
  description: 'Tasty.',
  cuisine: 'Danish',
  mainProtein,
  cookingMinutes: 30,
  ingredients: [
    { name: mainProtein, grams: 400, offerId: `offer-${date}` },
    { name: 'potatoes', grams: 600, offerId: null },
  ],
  steps: ['Cook.', 'Eat.'],
  estimatedCostDkk: 80,
  ...extra,
});

const goodNutrition: Nutrition = { kcal: 650, protein: 40, fat: 20, saturatedFat: 5, carbs: 60, sugars: 5, fiber: 8, salt: 1.5, unmatched: [] };

function context(plan: MealPlanDraft, overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    week: { key: '2026-W45', dates },
    preferences: PreferencesSchema.parse({ householdId: 'home', settings: { dinnersPerWeek: plan.dinners.length } }),
    history: [],
    offers: new Map(plan.dinners.map((d) => [`offer-${d.date}`, { validFrom: '2026-11-01T23:00:00.000Z', validTo: '2026-11-08T22:59:59.000Z', everydayPrice: false }])),
    nutrition: new Map(plan.dinners.map((d) => [d.date, goodNutrition])),
    weekdays: new Set(dates.slice(0, 5)),
    ...overrides,
  };
}

const plan = (dinners: DinnerDraft[]): MealPlanDraft => ({ dinners, notes: '' });

describe('checkPlan', () => {
  it('accepts a varied plan', () => {
    const p = plan([dinner(dates[0]!, 'Salmon bowl', 'salmon'), dinner(dates[1]!, 'Chicken curry', 'chicken'), dinner(dates[2]!, 'Lentil soup', 'lentils')]);
    expect(checkPlan(p, context(p))).toEqual([]);
  });

  it('blocks allergens using allergen groups', () => {
    const p = plan([dinner(dates[0]!, 'Shrimp pasta', 'shrimp')]);
    const ctx = context(p);
    ctx.preferences.members.push({ name: 'Tomas', allergies: ['shellfish'], dislikes: [], likes: [], diet: null });
    const issues = checkPlan(p, ctx);
    expect(hasBlocking(issues)).toBe(true);
    expect(issues[0]!.message).toContain("Tomas's shellfish allergy");
  });

  it('matches allergens at word starts only', () => {
    const p = plan([
      dinner(dates[0]!, 'Coconut curry with butternut squash', 'chickpeas'),
      dinner(dates[1]!, 'Walnut pesto pasta', 'walnuts'),
    ]);
    const ctx = context(p);
    ctx.preferences.members.push({ name: 'Ida', allergies: ['nuts'], dislikes: [], likes: [], diet: null });
    expect(checkPlan(p, ctx).map((i) => i.date)).toEqual([dates[1]]);
  });

  it('blocks wrong dinner count, dates outside the week and duplicate dishes', () => {
    const p = plan([dinner(dates[0]!, 'Tacos', 'beef'), dinner('2026-11-20', 'Tacos', 'beef')]);
    const ctx = context(p, {
      preferences: PreferencesSchema.parse({ householdId: 'home', settings: { dinnersPerWeek: 5 } }),
      offers: new Map([[`offer-${dates[0]}`, { validFrom: '2026-11-01T23:00:00.000Z', validTo: '2026-11-08T22:59:59.000Z', everydayPrice: false }], ['offer-2026-11-20', { validFrom: '2026-11-01T23:00:00.000Z', validTo: '2026-11-30T22:59:59.000Z', everydayPrice: false }]]),
      nutrition: new Map([[dates[0]!, goodNutrition], ['2026-11-20', goodNutrition]]),
    });
    const messages = checkPlan(p, ctx).filter((i) => i.severity === 'blocking').map((i) => i.message);
    expect(messages).toEqual([
      'The plan has 2 dinners but the household wants 5.',
      '2026-11-20 is not in week 2026-W45 (2026-11-02 to 2026-11-08).',
      '"Tacos" is also planned on 2026-11-02.',
    ]);
  });

  it('flags a protein used more than twice and dishes served recently', () => {
    const p = plan([
      dinner(dates[0]!, 'Chicken curry', 'chicken'),
      dinner(dates[1]!, 'Chicken wraps', 'Chicken'),
      dinner(dates[2]!, 'Roast chicken', 'chicken'),
    ]);
    const ctx = context(p, {
      history: [{ date: '2026-10-20', dish: 'Chicken Curry', mainProtein: 'chicken', cuisine: null, tags: [], rating: null }],
    });
    const messages = checkPlan(p, ctx).map((i) => `${i.severity}: ${i.message}`);
    expect(messages).toContain('major: chicken is the main protein in 3 dinners; use it at most twice.');
    expect(messages).toContain('major: "Chicken curry" was already served on 2026-10-20.');
  });

  it('blocks dishes rated thumbs down', () => {
    const p = plan([dinner(dates[0]!, 'Fish cakes', 'cod')]);
    const ctx = context(p, {
      history: [{ date: '2026-09-01', dish: 'Fish cakes', mainProtein: 'cod', cuisine: null, tags: [], rating: 'down' }],
    });
    expect(hasBlocking(checkPlan(p, ctx))).toBe(true);
  });

  it('blocks unknown offers and flags dinners without deals', () => {
    const p = plan([
      dinner(dates[0]!, 'Salmon bowl', 'salmon', { ingredients: [{ name: 'salmon', grams: 400, offerId: 'made-up' }, { name: 'rice', grams: 200, offerId: null }] }),
      dinner(dates[1]!, 'Omelette', 'eggs', { ingredients: [{ name: 'eggs', grams: 400, offerId: null }, { name: 'cheese', grams: 100, offerId: null }] }),
    ]);
    const messages = checkPlan(p, context(p)).map((i) => `${i.severity}: ${i.message}`);
    expect(messages).toContain('blocking: Offer made-up does not exist; only use ids returned by search_offers.');
    expect(messages).toContain('major: No ingredient is bought on offer; build the dinner around at least one current deal.');
  });

  it('flags dinners built only on everyday prices', () => {
    const p = plan([dinner(dates[0]!, 'Salmon bowl', 'salmon')]);
    const ctx = context(p);
    ctx.offers.set(`offer-${dates[0]}`, { ...ctx.offers.get(`offer-${dates[0]}`)!, everydayPrice: true });
    expect(checkPlan(p, ctx).map((i) => `${i.severity}: ${i.message}`)).toEqual([
      "minor: Only everyday prices are used; prefer at least one of this week's real deals if one fits.",
    ]);
  });

  it('checks nutrition ranges and weekday cooking time', () => {
    const p = plan([dinner(dates[0]!, 'Slow roast', 'pork', { cookingMinutes: 180 }), dinner(dates[5]!, 'Sunday roast', 'beef', { cookingMinutes: 180 })]);
    const ctx = context(p, {
      nutrition: new Map([[dates[0]!, { ...goodNutrition, kcal: 1400, protein: 12 }], [dates[5]!, goodNutrition]]),
    });
    const messages = checkPlan(p, ctx).map((i) => i.message);
    expect(messages).toContain('1400 kcal per serving is outside 400-1000; adjust portions.');
    expect(messages).toContain('12 g protein per serving is below 20 g.');
    expect(messages).toContain('180 minutes is over the 45-minute weekday limit.');
    expect(messages.filter((m) => m.includes('weekday limit'))).toHaveLength(1);
  });
});
