import { CHAINS, CountrySchema, LocationSchema, chainsFor, countryInfo, marketFor, type Preferences } from '@dinner/shared';
import { z } from 'zod';

/** Rough bounding box of Sweden, to catch a swapped latitude/longitude or a location in the wrong country. */
const SWEDEN = { latMin: 55.0, latMax: 69.2, lngMin: 10.5, lngMax: 24.3 };

export const HouseholdUpdateSchema = z
  .object({
    country: CountrySchema,
    location: LocationSchema.nullable().default(null),
    preferredChains: z.array(z.enum(CHAINS.map((c) => c.id) as [string, ...string[]])).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.country !== 'SE') return;
    if (!value.location) {
      ctx.addIssue({ code: 'custom', path: ['location'], message: 'A household in Sweden needs a location to find nearby stores.' });
      return;
    }
    const { lat, lng } = value.location;
    if (lat < SWEDEN.latMin || lat > SWEDEN.latMax || lng < SWEDEN.lngMin || lng > SWEDEN.lngMax) {
      ctx.addIssue({ code: 'custom', path: ['location'], message: 'That location is not in Sweden.' });
    }
  });
export type HouseholdUpdate = z.infer<typeof HouseholdUpdateSchema>;

/** The household settings the web app shows: where it shops and which chains it can choose from. */
export function householdView(preferences: Preferences) {
  const { country, location } = preferences.market;
  return {
    householdId: preferences.householdId,
    country,
    location,
    currency: countryInfo(country).currency,
    preferredChains: preferences.settings.preferredChains,
    chains: {
      DK: chainsFor('DK').map((c) => ({ id: c.id, name: c.name })),
      SE: chainsFor('SE').map((c) => ({ id: c.id, name: c.name })),
    },
    /** False until a Swedish household has chosen its location. */
    ready: marketFor(preferences.market) !== null,
  };
}

/** Offers only need refreshing when the household moves to another offer market. */
export const marketChanged = (before: Preferences, after: Preferences) => marketFor(before.market)?.key !== marketFor(after.market)?.key;
