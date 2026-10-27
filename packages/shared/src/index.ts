export const PROJECT_NAME = 'dinner-planner';

export const STAGES = ['prod'] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

/** Cognito custom attribute carrying the household a user belongs to. */
export const HOUSEHOLD_ATTRIBUTE = 'custom:householdId';

export * from './chains.js';
export * from './offer.js';
export * from './week.js';
