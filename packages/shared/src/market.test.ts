import { describe, expect, it } from 'vitest';
import { chainsFor } from './chains.js';
import { proteinFamily } from './checks.js';
import { distanceKm, marketFor, snapshotKey } from './market.js';
import { StoredPlanSchema, migratePlan } from './plan.js';

describe('offer markets', () => {
  it('uses one national Danish market and a rounded location in Sweden', () => {
    expect(marketFor({ country: 'DK', location: null })?.key).toBe('dk');
    expect(marketFor({ country: 'SE', location: { lat: 57.70891, lng: 11.97456, label: 'Göteborg' } })?.key).toBe('se-57.71_11.97');
    expect(marketFor({ country: 'SE', location: null })).toBeNull();
    expect(snapshotKey('dk', '2026-W46')).toBe('snapshots/dk/2026-W46/offers.json');
  });

  it('lists the chains of each country', () => {
    expect(chainsFor('SE').map((c) => c.id)).toEqual(
      expect.arrayContaining(['ica-maxi', 'ica-supermarket', 'hemkop', 'willys', 'lidl-se', 'coop-se', 'city-gross']),
    );
    expect(chainsFor('SE').every((c) => c.country === 'SE')).toBe(true);
    expect(chainsFor('DK').map((c) => c.id)).not.toContain('lovbjerg');
  });

  it('measures distances in km', () => {
    expect(Math.round(distanceKm({ lat: 55.6761, lng: 12.5683 }, { lat: 55.605, lng: 13.0038 }))).toBe(28);
  });

  it('groups Swedish protein names into families', () => {
    expect(['kycklingfilé', 'fläskfilé', 'laxfilé', 'blandfärs med nötkött', 'röda linser'].map(proteinFamily)).toEqual([
      'chicken',
      'pork',
      'fish',
      'beef',
      'legumes',
    ]);
  });
});

describe('migratePlan', () => {
  it('renames the old DKK cost field and defaults the currency', () => {
    const legacy = {
      householdId: 'home',
      week: '2026-W45',
      status: 'approved',
      dinners: [
        {
          date: '2026-11-02',
          dish: 'Tacos',
          description: 'Tasty.',
          cuisine: 'Mexican',
          mainProtein: 'beef',
          cookingMinutes: 30,
          ingredients: [
            { name: 'beef', grams: 400, offerId: null },
            { name: 'tortillas', grams: 300, offerId: null },
          ],
          steps: ['Cook.', 'Eat.'],
          estimatedCostDkk: 80,
          servings: 2,
          nutrition: { kcal: 600, protein: 40, fat: 20, saturatedFat: 5, carbs: 50, sugars: 5, fiber: 6, salt: 1, unmatched: [] },
          imageUrl: null,
        },
      ],
      notes: '',
      verdict: { score: 8, approved: true, summary: 'Good.', issues: [] },
      checks: [],
      rounds: 1,
      models: { planner: 'p', judge: 'j' },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
      generatedAt: '2026-11-01T16:00:00.000Z',
      shoppingList: { stores: [], other: [], offerTotal: 0 },
      state: 'ready',
      executionId: null,
      updatedAt: '2026-11-01T16:00:00.000Z',
    };
    const plan = StoredPlanSchema.parse(migratePlan(legacy));
    expect(plan.currency).toBe('DKK');
    expect(plan.dinners[0]!.estimatedCost).toBe(80);
  });
});
