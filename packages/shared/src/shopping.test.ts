import { describe, expect, it } from 'vitest';
import { buildShoppingList } from './shopping.js';
import type { Dinner, Offer } from './index.js';


const offer = (id: string, chain: Offer['chain'], heading: string, price: number): Offer => ({
  id,
  source: 'tjek',
  chain,
  heading,
  description: null,
  price,
  prePrice: null,
  currency: 'DKK',
  amount: null,
  unitPrice: null,
  validFrom: '2026-10-31T23:00:00.000Z',
  validTo: '2026-11-06T22:59:59.000Z',
  publishedAt: null,
  imageUrl: null,
  catalogId: null,
  tags: null,
});

const dinner = (date: string, dish: string, ingredients: Dinner['ingredients']): Dinner => ({
  date,
  dish,
  description: 'Weeknight favourite.',
  cuisine: 'Danish',
  mainProtein: 'pork',
  cookingMinutes: 30,
  ingredients,
  steps: ['Cook it.', 'Serve it.'],
  estimatedCostDkk: 80,
  servings: 2,
  nutrition: { kcal: 650, protein: 40, fat: 20, saturatedFat: 6, carbs: 60, sugars: 5, fiber: 7, salt: 1.2, unmatched: [] },
});
const offers = new Map([
  ['a', offer('a', 'netto', 'Hakket oksekød', 39)],
  ['b', offer('b', 'netto', 'Kartofler 2 kg', 15)],
  ['c', offer('c', 'lidl', 'Laksefilet', 89.95)],
]);

describe('buildShoppingList', () => {
  it('groups offers by store, counts shared offers once and sums other ingredients', () => {
    const list = buildShoppingList(
      [
        dinner('2026-11-02', 'Bolognese', [
          { name: 'minced beef', grams: 500, offerId: 'a' },
          { name: 'onion', grams: 100, offerId: null },
        ]),
        dinner('2026-11-03', 'Salmon', [
          { name: 'salmon', grams: 400, offerId: 'c' },
          { name: 'potatoes', grams: 600, offerId: 'b' },
          { name: 'Onion ', grams: 50, offerId: null },
        ]),
        dinner('2026-11-05', 'Pork', [
          { name: 'potatoes', grams: 500, offerId: 'b' },
          { name: 'unknown deal', grams: 100, offerId: 'gone' },
        ]),
      ],
      offers,
    );

    expect(list.stores.map((s) => [s.chainName, s.subtotal])).toEqual([
      ['Lidl', 89.95],
      ['Netto', 54],
    ]);
    expect(list.stores[1]!.items.find((i) => i.offerId === 'b')!.forDinners).toEqual(['2026-11-03', '2026-11-05']);
    expect(list.other).toEqual([
      { name: 'onion', grams: 150, forDinners: ['2026-11-02', '2026-11-03'] },
      { name: 'unknown deal', grams: 100, forDinners: ['2026-11-05'] },
    ]);
    expect(list.offerTotal).toBe(143.95);
  });
});
