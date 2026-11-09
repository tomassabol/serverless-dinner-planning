import { describe, expect, it } from 'vitest';
import { PreferencesSchema } from '@dinner/shared';
import { HouseholdUpdateSchema, householdView, marketChanged } from '../src/household.js';

const goteborg = { lat: 57.7089, lng: 11.9746, label: 'Göteborg' };

describe('household settings', () => {
  it('requires a location inside Sweden for Swedish households', () => {
    expect(HouseholdUpdateSchema.safeParse({ country: 'SE', location: goteborg }).success).toBe(true);
    expect(HouseholdUpdateSchema.safeParse({ country: 'SE' }).error?.issues[0]?.message).toContain('needs a location');
    expect(HouseholdUpdateSchema.safeParse({ country: 'SE', location: { ...goteborg, lat: 11.97, lng: 57.7 } }).error?.issues[0]?.message).toBe(
      'That location is not in Sweden.',
    );
    expect(HouseholdUpdateSchema.parse({ country: 'DK' })).toEqual({ country: 'DK', location: null });
    expect(HouseholdUpdateSchema.safeParse({ country: 'NO' }).success).toBe(false);
  });

  it('shows the market, currency and chains for both countries', () => {
    const danish = PreferencesSchema.parse({ householdId: 'home' });
    expect(householdView(danish)).toMatchObject({ country: 'DK', currency: 'DKK', ready: true, location: null });
    expect(householdView(danish).chains.SE.map((c) => c.id)).toContain('hemkop');

    const unset = PreferencesSchema.parse({ householdId: 'x', market: { country: 'SE' } });
    expect(householdView(unset).ready).toBe(false);
  });

  it('detects a change of offer market', () => {
    const danish = PreferencesSchema.parse({ householdId: 'home' });
    const swedish = PreferencesSchema.parse({ householdId: 'home', market: { country: 'SE', location: goteborg } });
    const nearby = PreferencesSchema.parse({ householdId: 'home', market: { country: 'SE', location: { ...goteborg, lat: 57.7091, label: 'Göteborg C' } } });
    expect(marketChanged(danish, swedish)).toBe(true);
    expect(marketChanged(swedish, nearby)).toBe(false);
  });
});
