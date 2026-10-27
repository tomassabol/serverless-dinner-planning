import { z } from 'zod';
import { ChainIdSchema } from './chains.js';

export const OFFER_CATEGORIES = [
  'meat',
  'poultry',
  'fish',
  'vegetarian_protein',
  'vegetables',
  'fruit',
  'carbs',
  'dairy',
  'pantry',
  'ready_meal',
  'snacks',
  'beverages',
  'non_food',
] as const;

export const OfferCategorySchema = z.enum(OFFER_CATEGORIES);
export type OfferCategory = z.infer<typeof OfferCategorySchema>;

/** Unit used for comparable prices: per kilogram, per litre or per piece. */
export const UnitSchema = z.enum(['kg', 'l', 'pcs']);
export type Unit = z.infer<typeof UnitSchema>;

export const OfferTagsSchema = z.object({
  category: OfferCategorySchema,
  /** Short English ingredient name, e.g. "pork tenderloin". Empty for non-food. */
  canonicalIngredient: z.string(),
  /** Whether the item could plausibly be part of a home-cooked dinner. */
  dinnerRelevant: z.boolean(),
  model: z.string(),
  taggedAt: z.iso.datetime(),
});
export type OfferTags = z.infer<typeof OfferTagsSchema>;

export const OfferSchema = z.object({
  id: z.string(),
  source: z.literal('tjek'),
  chain: ChainIdSchema,
  heading: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  prePrice: z.number().nullable(),
  currency: z.string(),
  /** Total amount in `unit`, as a range (packs often say e.g. "400-500 g"). */
  amount: z
    .object({
      unit: UnitSchema,
      from: z.number(),
      to: z.number(),
    })
    .nullable(),
  /** Price per kg / l / pcs based on the midpoint of `amount`. */
  unitPrice: z.object({ value: z.number(), unit: UnitSchema }).nullable(),
  validFrom: z.iso.datetime({ offset: true }),
  validTo: z.iso.datetime({ offset: true }),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  imageUrl: z.string().nullable(),
  catalogId: z.string().nullable(),
  tags: OfferTagsSchema.nullable(),
});
export type Offer = z.infer<typeof OfferSchema>;

export function isFoodOffer(offer: Offer): boolean {
  return offer.tags !== null && offer.tags.category !== 'non_food';
}
