import { describe, expect, it } from 'vitest';
import { callerFrom } from '../src/identity.js';
import { titleFrom } from '../src/conversations.js';

const event = (claims: Record<string, string>) => ({ requestContext: { authorizer: { claims } } }) as never;

describe('callerFrom', () => {
  it('reads household, user and name from the verified claims', () => {
    expect(callerFrom(event({ sub: 'u1', 'custom:householdId': 'home', given_name: 'Tomas', email: 'x@y.z' }))).toEqual({
      householdId: 'home',
      userId: 'u1',
      userName: 'Tomas',
    });
    expect(callerFrom(event({ sub: 'u2', 'custom:householdId': 'home', email: 'ida@example.com' })).userName).toBe('ida');
  });

  it('rejects tokens without a valid household', () => {
    expect(() => callerFrom(event({ sub: 'u1' }))).toThrow();
    expect(() => callerFrom(event({ sub: 'u1', 'custom:householdId': 'Bad Id' }))).toThrow();
  });
});

describe('titleFrom', () => {
  it('keeps short messages and truncates long ones on one line', () => {
    expect(titleFrom('  Swap\nWednesday  ')).toBe('Swap Wednesday');
    expect(titleFrom('a'.repeat(80))).toHaveLength(58);
  });
});
