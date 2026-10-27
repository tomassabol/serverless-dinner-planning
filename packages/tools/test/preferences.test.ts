import { describe, expect, it } from 'vitest';
import { PreferencesSchema } from '@dinner/shared';
import { applyPreferenceUpdate } from '../src/preferences.js';

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
