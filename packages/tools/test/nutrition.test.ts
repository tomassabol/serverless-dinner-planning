import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NutritionDb, tokenize, type FridaFood } from '../src/nutrition.js';

const foods = JSON.parse(readFileSync(new URL('../data/frida-foods.json', import.meta.url), 'utf8')) as FridaFood[];
const db = new NutritionDb(foods);
const best = (ingredient: string) => db.search(ingredient)[0]?.food.nameEn;

describe('tokenize', () => {
  it('stems plurals and maps synonyms', () => {
    expect(tokenize('Minced potatoes, eggs')).toEqual(['mince', 'potato', 'egg']);
  });
});

describe('NutritionDb.search', () => {
  it.each([
    ['chicken breast', 'Chicken, breast, flesh and skin, raw'],
    ['minced beef', /^Beef, mince/],
    ['ground turkey', /^Turkey, mince/],
    ['pork tenderloin', 'Pork, tenderloin, trimmed, raw'],
    ['salmon fillet', 'Salmon, atlantic, aquaculture, raw'],
    ['cod', 'Cod, fillet, raw'],
    ['rice', 'Rice, polished, raw'],
    ['pasta', 'Pasta, raw'],
    ['penne pasta', 'Pasta, raw'],
    ['fusilli', 'Pasta, raw'],
    ['potatoes', 'Potato, raw'],
    ['broccoli', 'Broccoli, raw'],
    ['eggs', /^Eggs, chicken, .*raw/],
    ['butter', /^Butter, salt/],
    ['cream', 'Cream, 18 % fat'],
    ['milk', /^Milk, partly skimmed/],
    ['olive oil', 'Olive oil'],
    ['red lentils', 'Lentils, red, dried, raw'],
    ['zucchini', /^Squash/],
  ])('%s → %s', (ingredient, expected) => {
    expect(best(ingredient)).toMatch(expected);
  });

  it('returns nothing rather than a wrong food', () => {
    expect(best('coconut milk')).toBeUndefined();
    expect(best('tortilla')).toBeUndefined();
  });
});

describe('NutritionDb.lookup', () => {
  it('scales per-100g values by grams and sums the total', () => {
    const result = db.lookup([
      { ingredient: 'chicken breast', grams: 200 },
      { ingredient: 'rice', grams: 50 },
      { ingredient: 'coconut milk', grams: 100 },
    ]);
    const [chicken, rice] = result.items;
    const per100g = foods.find((f) => f.id === chicken!.match!.id)!.per100g;
    expect(chicken!.nutrients!.kcal).toBe(Math.round(per100g.kcal * 2));
    expect(chicken!.nutrients!.protein).toBeCloseTo(per100g.protein * 2, 1);
    expect(result.total.kcal).toBe(Math.round(chicken!.nutrients!.kcal + rice!.nutrients!.kcal));
    expect(result.unmatched).toEqual(['coconut milk']);
    expect(chicken!.match?.confidence).toBe('high');
  });
});
