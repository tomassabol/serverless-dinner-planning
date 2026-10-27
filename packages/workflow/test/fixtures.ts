import type { Dinner, Offer } from '@dinner/shared';

export const offer = (id: string, chain: Offer['chain'], heading: string, price: number): Offer => ({
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

export const dinner = (date: string, dish: string, ingredients: Dinner['ingredients']): Dinner => ({
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
