export interface FridaFood {
  id: number;
  nameDa: string;
  nameEn: string;
  group: string;
  per100g: {
    kcal: number;
    protein: number;
    fat: number;
    saturatedFat: number;
    carbs: number;
    sugars: number;
    fiber: number;
    salt: number;
  };
}

export type Nutrients = FridaFood['per100g'];

export interface NutritionItem {
  ingredient: string;
  grams: number;
}

export interface NutritionMatch {
  ingredient: string;
  grams: number;
  match: { id: number; name: string; group: string; confidence: 'high' | 'medium' } | null;
  alternatives: string[];
  nutrients: Nutrients | null;
}

const ZERO: Nutrients = { kcal: 0, protein: 0, fat: 0, saturatedFat: 0, carbs: 0, sugars: 0, fiber: 0, salt: 0 };

/** Everyday cooking terms that Frida names differently. Values are search phrases, not IDs. */
const ALIASES: Record<string, string> = {
  cream: 'cream 18 fat',
  'cooking cream': 'cream 18 fat',
  'whipping cream': 'cream 38 fat',
  'heavy cream': 'cream 38 fat',
  'sour cream': 'cream cultured 18 fat',
  'creme fraiche': 'cream cultured 18 fat',
  'crème fraîche': 'cream cultured 18 fat',
  butter: 'butter salt added',
  rice: 'rice polished raw',
  'white rice': 'rice polished raw',
  egg: 'egg chicken free-range indoor raw',
  milk: 'milk partly skimmed 1.5 fat',
  cod: 'cod fillet raw',
  zucchini: 'squash raw',
  courgette: 'squash raw',
  'minced pork': 'pork meat lean',
  'ground pork': 'pork meat lean',
  salmon: 'salmon atlantic aquaculture raw',
  'salmon fillet': 'salmon atlantic aquaculture raw',
  spaghetti: 'pasta raw',
  noodles: 'pasta raw',
  'chicken breast': 'chicken breast flesh skin raw',
  'chicken thigh': 'chicken leg flesh skin raw',
  'bell pepper': 'pepper sweet red raw',
  'red pepper': 'pepper sweet red raw',
  'feta cheese': 'feta',
};

const SYNONYMS: Record<string, string> = {
  minced: 'mince',
  ground: 'mince',
  hakket: 'mince',
  filet: 'fillet',
  fillets: 'fillet',
  yogurt: 'yoghurt',
};

const STOPWORDS = new Set(['fresh', 'organic', 'danish', 'of', 'and', 'the', 'a', 'chopped', 'sliced', 'diced']);

/** Name tokens that describe processing; they cost points unless the query asks for them. */
const PROCESSED = new Set([
  'fried', 'deepfried', 'canned', 'dried', 'powder', 'smoked', 'battered', 'breaded', 'boiled', 'grilled',
  'pickled', 'frozen', 'instant', 'cookie', 'cookies', 'crisps', 'dessert', 'pastry', 'cake', 'takeaway',
  'fast', 'industrially', 'sauce', 'salad', 'with', 'starch', 'flour', 'bran', 'drink', 'spiced', 'cooked',
  'cured', 'paste', 'sausage', 'bound', 'gravy', 'roll', 'dressing', 'topping', 'groats',
]);

/** Tokens that carry no meaning for matching on their own. */
const NEUTRAL = /^(raw|fat|fidm|approx|average|values|\d+([.-]\d+)?)$/;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9æøåéè.\-\s]/g, ' ')
    .split(/[\s,]+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t && !STOPWORDS.has(t))
    .map(stem)
    .map((t) => SYNONYMS[t] ?? t);
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('oes')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Alias keys normalized the same way as queries, so "eggs" and "minced pork" hit their aliases. */
const NORMALIZED_ALIASES = new Map(Object.entries(ALIASES).map(([key, phrase]) => [tokenize(key).join(' '), phrase]));

interface Indexed {
  food: FridaFood;
  tokens: Set<string>;
  head: Set<string>;
  daTokens: Set<string>;
}

export class NutritionDb {
  private readonly index: Indexed[];

  constructor(foods: FridaFood[]) {
    this.index = foods.map((food) => ({
      food,
      tokens: new Set(tokenize(food.nameEn)),
      head: new Set(tokenize(food.nameEn.split(',')[0] ?? '')),
      daTokens: new Set(tokenize(food.nameDa)),
    }));
  }

  /** Ranked candidates for an ingredient name (English or Danish). */
  search(ingredient: string, limit = 4): { food: FridaFood; score: number; headMatch: boolean }[] {
    const phrase = NORMALIZED_ALIASES.get(tokenize(ingredient).join(' ')) ?? ingredient;
    const query = tokenize(phrase);
    if (query.length === 0) return [];
    const wanted = new Set(query);

    const scored = [];
    for (const entry of this.index) {
      const matchesEn = query.every((q) => hasToken(entry.tokens, q));
      const matchesDa = !matchesEn && query.every((q) => hasToken(entry.daTokens, q));
      if (!matchesEn && !matchesDa) continue;

      const tokens = matchesEn ? entry.tokens : entry.daTokens;
      const headMatch = matchesEn && query.some((q) => hasToken(entry.head, q));
      let score = 10 + (headMatch ? 4 : 0);
      for (const token of tokens) {
        if (wanted.has(token)) continue;
        if (PROCESSED.has(token)) score -= 4;
        else if (token === 'raw') score += 2;
        else if (!NEUTRAL.test(token)) score -= 1;
      }
      scored.push({ food: entry.food, score, headMatch });
    }
    return scored.sort((a, b) => b.score - a.score || a.food.nameEn.length - b.food.nameEn.length).slice(0, limit);
  }

  lookup(items: NutritionItem[]): { items: NutritionMatch[]; total: Nutrients; unmatched: string[] } {
    const total = { ...ZERO };
    const matches: NutritionMatch[] = items.map((item) => {
      const [best, ...rest] = this.search(item.ingredient);
      if (!best) return { ...item, match: null, alternatives: [], nutrients: null };

      const nutrients = scale(best.food.per100g, item.grams / 100);
      for (const key of Object.keys(total) as (keyof Nutrients)[]) total[key] += nutrients[key];
      return {
        ...item,
        match: {
          id: best.food.id,
          name: best.food.nameEn,
          group: best.food.group,
          confidence: best.headMatch && best.score >= 10 ? 'high' : 'medium',
        },
        alternatives: rest.map((r) => r.food.nameEn),
        nutrients,
      };
    });
    return {
      items: matches,
      total: scale(total, 1),
      unmatched: matches.filter((m) => !m.match).map((m) => m.ingredient),
    };
  }
}

function hasToken(tokens: Set<string>, query: string): boolean {
  if (tokens.has(query)) return true;
  if (query.length < 4) return false;
  for (const token of tokens) if (token.startsWith(query) || query.startsWith(token)) return token.length >= 4;
  return false;
}

function scale(n: Nutrients, factor: number): Nutrients {
  return Object.fromEntries(
    Object.entries(n).map(([k, v]) => [k, round(v * factor, k === 'kcal' ? 0 : 1)]),
  ) as Nutrients;
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;
