import { HOUSEHOLD_ATTRIBUTE, HouseholdIdSchema } from '@dinner/shared';
import type { APIGatewayProxyEvent } from 'aws-lambda';

export interface Caller {
  householdId: string;
  userId: string;
  userName: string;
}

/**
 * The household and name come from the Cognito ID token claims that the API Gateway authorizer
 * already verified; nothing identity-related is read from the request body.
 */
export function callerFrom(event: Pick<APIGatewayProxyEvent, 'requestContext'>): Caller {
  const claims = (event.requestContext.authorizer?.claims ?? {}) as Record<string, string | undefined>;
  const householdId = HouseholdIdSchema.parse(claims[HOUSEHOLD_ATTRIBUTE]);
  const userId = claims.sub;
  if (!userId) throw new Error('Missing sub claim');
  const userName = claims.given_name?.trim() || claims.email?.split('@')[0] || 'Someone';
  return { householdId, userId, userName };
}
