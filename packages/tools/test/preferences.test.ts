import { describe, expect, it } from 'vitest';
import { PreferencesSchema, migratePreferences } from '@dinner/shared';
import { applyMarketUpdate, applyPreferenceUpdate, describePreferences } from '../src/preferences.js';

const now = new Date('2026-10-28T10:00:00Z');
const empty = PreferencesSchema.parse({ householdId: 'home' });

describe('applyPreferenceUpdate', () => {
  it('creates a member and dedupes case-insensitively', () => {
    const result = applyPreferenceUpdate(empty, { member: 'Tomas', addAllergies: ['Peanuts', 'peanuts ', 'shrimp'] }, now);
    expect(result.members).toEqual([{ name: 'Tomas', allergies: ['Peanuts', 'shrimp'], dislikes: [], likes: [], diet: null }]);
    expect(result.updatedAt).toBe(now.toISOString());
  });

  it('removes entries and merges settings', () => {
    const start = applyPreferenceUpdate(empty, { member: 'Tomas', addDislikes: ['olives', 'Liver'] }, now);
    const result = applyPreferenceUpdate(
      start,
      { member: 'tomas', removeDislikes: ['liver'], settings: { dinnersPerWeek: 6 } },
      now,
    );
    expect(result.members[0]!.dislikes).toEqual(['olives']);
    expect(result.settings.dinnersPerWeek).toBe(6);
    expect(result.settings.servings).toBe(2);
  });

  it('requires a member for member-level changes', () => {
    expect(() => applyPreferenceUpdate(empty, { addAllergies: ['nuts'] }, now)).toThrow('member is required');
  });
});

describe('household market', () => {
  const goteborg = { lat: 57.7089, lng: 11.9746, label: 'Göteborg' };

  it('defaults to Denmark and describes the available chains', () => {
    const described = describePreferences(empty);
    expect(empty.market).toEqual({ country: 'DK', location: null });
    expect(described).toMatchObject({ country: 'Denmark', currency: 'DKK' });
    expect(described.availableChains.map((c) => c.id)).toContain('netto');
    expect(described.availableChains.map((c) => c.id)).not.toContain('hemkop');
  });

  it('moves a household to Sweden and drops Danish preferred chains', () => {
    const danish = applyPreferenceUpdate(empty, { settings: { preferredChains: ['netto', 'lidl'] } }, now);
    const swedish = applyMarketUpdate(danish, { country: 'SE', location: goteborg }, undefined, now);
    expect(swedish.market).toEqual({ country: 'SE', location: goteborg });
    expect(swedish.settings.preferredChains).toEqual([]);
    expect(describePreferences(swedish)).toMatchObject({ currency: 'SEK' });
    expect(applyMarketUpdate(danish, { country: 'SE', location: goteborg }, ['hemkop', 'willys'], now).settings.preferredChains).toEqual(['hemkop', 'willys']);
  });

  it('requires a Swedish location and chains from the household country', () => {
    expect(() => applyMarketUpdate(empty, { country: 'SE', location: null }, undefined, now)).toThrow('location');
    expect(() => applyMarketUpdate(empty, { country: 'SE', location: goteborg }, ['netto'], now)).toThrow('Not available in Sweden');
    expect(() => applyPreferenceUpdate(empty, { settings: { preferredChains: ['hemkop'] } }, now)).toThrow('Hemköp is not available');
    expect(applyMarketUpdate(empty, { country: 'DK', location: goteborg }, undefined, now).market.location).toBeNull();
  });

  it('reads preferences stored with the old budget field', () => {
    const migrated = PreferencesSchema.parse(migratePreferences({ householdId: 'home', settings: { weeklyBudgetDkk: 600, servings: 3 } }));
    expect(migrated.settings).toMatchObject({ weeklyBudget: 600, servings: 3 });
  });
});
