import type { Dinner } from '@dinner/shared';

/** Stability Stable Image Core in us-west-2; no text-to-image model is offered in the EU regions. */
export const IMAGE_MODEL_ID = 'stability.stable-image-core-v1:1';
export const IMAGE_MODEL_REGION = 'us-west-2';

export function imagePrompt(dinner: Pick<Dinner, 'dish' | 'description' | 'cuisine'>): { prompt: string; negativePrompt: string } {
  return {
    prompt: `Overhead food photography of ${dinner.dish}, a home-cooked ${dinner.cuisine} dinner. ${dinner.description} Served on a rustic ceramic plate on a wooden Scandinavian kitchen table, soft natural window light, appetizing, high detail.`,
    negativePrompt: 'text, letters, watermark, logo, hands, people, cartoon, illustration, blurry',
  };
}

/** The dish is part of the key, so a re-planned day gets a new image while unchanged days are reused. */
export function imageKey(householdId: string, week: string, dinner: Pick<Dinner, 'date' | 'dish'>): string {
  const slug = dinner.dish
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `images/${householdId}/${week}/${dinner.date}-${slug}.jpg`;
}
