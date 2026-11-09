import { paginateListUsers, type CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { HOUSEHOLD_ATTRIBUTE, HouseholdIdSchema } from '@dinner/shared';

export interface HouseholdMember {
  householdId: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Households are defined by Cognito users: every enabled user carries `custom:householdId`.
 * Cognito cannot filter on custom attributes, so the (small) pool is listed and grouped here.
 */
export async function listHouseholdMembers(cognito: CognitoIdentityProviderClient, userPoolId: string): Promise<HouseholdMember[]> {
  const members: HouseholdMember[] = [];
  for await (const page of paginateListUsers({ client: cognito }, { UserPoolId: userPoolId })) {
    for (const user of page.Users ?? []) {
      const attrs = Object.fromEntries((user.Attributes ?? []).map((a) => [a.Name, a.Value]));
      const householdId = HouseholdIdSchema.safeParse(attrs[HOUSEHOLD_ATTRIBUTE]);
      if (!user.Enabled || !householdId.success || !attrs.email) continue;
      members.push({ householdId: householdId.data, email: attrs.email, emailVerified: attrs.email_verified === 'true' });
    }
  }
  return members;
}

export const householdIds = (members: HouseholdMember[]) => [...new Set(members.map((m) => m.householdId))].sort();

/** Durable execution names allow letters, digits, '-' and '_' (max 64); one per household and week makes Sunday runs idempotent. */
export function weeklyExecutionName(week: string, householdId: string): string {
  return `weekly-${week}-${householdId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
}
