import { describe, expect, it } from 'vitest';
import { householdIds, weeklyExecutionName } from '../src/households.js';

describe('households', () => {
  it('lists each household once', () => {
    const members = [
      { householdId: 'home', email: 'a@x', emailVerified: true },
      { householdId: 'goteborg', email: 'b@x', emailVerified: true },
      { householdId: 'home', email: 'c@x', emailVerified: false },
    ];
    expect(householdIds(members)).toEqual(['goteborg', 'home']);
  });

  it('builds a valid, deterministic execution name', () => {
    expect(weeklyExecutionName('2026-W46', 'home')).toBe('weekly-2026-W46-home');
    expect(weeklyExecutionName('2026-W46', 'a'.repeat(64))).toHaveLength(64);
  });
});
