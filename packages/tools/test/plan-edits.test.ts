import { describe, expect, it } from 'vitest';
import { PreferencesSchema, type DinnerDraft, type Offer, type StoredPlan } from '@dinner/shared';
import { perServing, removeDinner, replaceDinner } from '../src/plan-edits.js';

const now = new Date('2026-11-03T10:00:00Z');

const offer = (id: string, validTo = '2026-11-08T22:59:59.000Z'): Offer => ({
  id,
  source: 'tjek',
  chain: 'netto',
  heading: `Offer ${id}`,
  description: null,
  price: 30,
  prePrice: null,
  currency: 'DKK',
  amount: null,
  unitPrice: null,
  validFrom: '2026-11-01T23:00:00.000Z',
  validTo,
  publishedAt: null,
  imageUrl: null,
  catalogId: null,
  tags: null,
});

const draft = (date: string, dish: string, ingredients: DinnerDraft['ingredients']): DinnerDraft => ({
  date,
  dish,
  description: 'Nice.',
  cuisine: 'Danish',
  mainProtein: 'cod',
  cookingMinutes: 25,
  ingredients,
  steps: ['Cook.', 'Serve.'],
  estimatedCostDkk: 70,
});

const nutrition = { kcal: 600, protein: 40, fat: 20, saturatedFat: 5, carbs: 50, sugars: 5, fiber: 6, salt: 1, unmatched: [] };

const plan: StoredPlan = {
  householdId: 'home',
  week: '2026-W45',
  status: 'approved',
  dinners: [
    { ...draft('2026-11-02', 'Old Monday', [{ name: 'pork', grams: 400, offerId: 'a' }, { name: 'rice', grams: 150, offerId: null }]), servings: 2, nutrition, imageUrl: 'x' },
    { ...draft('2026-11-04', 'Old Wednesday', [{ name: 'chicken', grams: 400, offerId: 'b' }, { name: 'rice', grams: 150, offerId: null }]), servings: 2, nutrition, imageUrl: 'y' },
  ],
  notes: '',
  verdict: { score: 8, approved: true, summary: '', issues: [] },
  checks: [],
  rounds: 1,
  models: { planner: 'p', judge: 'j' },
  usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
  generatedAt: now.toISOString(),
  shoppingList: { stores: [], other: [], offerTotal: 0 },
  state: 'ready',
  executionId: null,
  updatedAt: now.toISOString(),
};

const preferences = PreferencesSchema.parse({
  householdId: 'home',
  members: [{ name: 'Ida', allergies: ['shellfish'], dislikes: ['mushrooms'] }],
});

const offers = new Map([['a', offer('a')], ['b', offer('b')], ['c', offer('c', '2026-11-03T22:59:59.000Z')]]);

describe('replaceDinner', () => {
  it('replaces the dinner, rebuilds the shopping list and warns about dislikes and expiring offers', () => {
    const result = replaceDinner(
      plan,
      draft('2026-11-04', 'Cod with mushrooms', [{ name: 'cod', grams: 400, offerId: 'c' }, { name: 'mushrooms', grams: 200, offerId: null }]),
      { preferences, offers, nutrition, now },
    );
    expect(result.plan.dinners.map((d) => d.dish)).toEqual(['Old Monday', 'Cod with mushrooms']);
    expect(result.plan.dinners[1]!.imageUrl).toBeNull();
    expect(result.plan.shoppingList.stores[0]!.items.map((i) => i.offerId)).toEqual(['a', 'c']);
    expect(result.warnings).toEqual(['Ida dislikes mushrooms.', 'The cod offer ends 2026-11-03, so buy it before then.']);
  });

  it('adds a dinner on a free day', () => {
    const result = replaceDinner(plan, draft('2026-11-03', 'Tuesday soup', [{ name: 'lentils', grams: 200, offerId: null }, { name: 'carrot', grams: 200, offerId: null }]), {
      preferences,
      offers,
      nutrition,
      now,
    });
    expect(result.plan.dinners.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('refuses allergens, unknown offers and dates outside the week', () => {
    const shrimp = draft('2026-11-04', 'Shrimp tacos', [{ name: 'shrimp', grams: 300, offerId: null }, { name: 'tortillas', grams: 200, offerId: null }]);
    expect(() => replaceDinner(plan, shrimp, { preferences, offers, nutrition, now })).toThrow("Ida's shellfish allergy");

    const fake = draft('2026-11-04', 'Fake', [{ name: 'beef', grams: 300, offerId: 'nope' }, { name: 'rice', grams: 100, offerId: null }]);
    expect(() => replaceDinner(plan, fake, { preferences, offers, nutrition, now })).toThrow('offer nope does not exist');

    const late = draft('2026-11-12', 'Late', [{ name: 'beef', grams: 300, offerId: null }, { name: 'rice', grams: 100, offerId: null }]);
    expect(() => replaceDinner(plan, late, { preferences, offers, nutrition, now })).toThrow('not in week 2026-W45');
  });
});

describe('removeDinner', () => {
  it('removes a dinner and its offers from the shopping list', () => {
    const updated = removeDinner(plan, '2026-11-02', offers, now);
    expect(updated.dinners.map((d) => d.date)).toEqual(['2026-11-04']);
    expect(updated.shoppingList.stores[0]!.items.map((i) => i.offerId)).toEqual(['b']);
    expect(() => removeDinner(plan, '2026-11-06', offers, now)).toThrow('no dinner on 2026-11-06');
  });
});

describe('perServing', () => {
  it('divides recipe totals by servings', () => {
    const total = { kcal: 1301, protein: 81, fat: 40, saturatedFat: 10, carbs: 120, sugars: 9, fiber: 13, salt: 3 };
    expect(perServing(total, ['thyme'], 2)).toEqual({ kcal: 651, protein: 40.5, fat: 20, saturatedFat: 5, carbs: 60, sugars: 4.5, fiber: 6.5, salt: 1.5, unmatched: ['thyme'] });
  });
});
