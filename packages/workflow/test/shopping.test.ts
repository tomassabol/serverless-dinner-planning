import { describe, expect, it } from 'vitest';
import { buildShoppingList } from '../src/shopping.js';
import { dinner, offer } from './fixtures.js';

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
