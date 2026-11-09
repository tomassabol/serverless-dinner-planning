/**
 * Sunday entry point: refreshes every market's offers once, then starts one durable weekly-plan
 * execution per household (with `skipFetch`, since the offers are fresh). Households are the distinct
 * `custom:householdId` values of the enabled Cognito users, so a new household only needs its users.
 */
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { resolveWeekKey } from '@dinner/shared';
import { z } from 'zod';
import { env, logger, tracer } from '../clients.js';
import { householdIds, listHouseholdMembers, weeklyExecutionName } from '../households.js';

const { INGEST_FUNCTION_ARN, WEEKLY_PLAN_FUNCTION, USER_POOL_ID } = env('INGEST_FUNCTION_ARN', 'WEEKLY_PLAN_FUNCTION', 'USER_POOL_ID');
const lambda = tracer.captureAWSv3Client(new LambdaClient({}));
const cognito = tracer.captureAWSv3Client(new CognitoIdentityProviderClient({}));

const InputSchema = z.object({
  week: z.string().default('next'),
  /** Plan only these households (defaults to all). */
  householdIds: z.array(z.string()).optional(),
  skipFetch: z.boolean().default(false),
  sendEmail: z.boolean().default(true),
});

export const handler = async (event: unknown) => {
  const input = InputSchema.parse(event ?? {});
  const week = resolveWeekKey(input.week, new Date());
  const all = householdIds(await listHouseholdMembers(cognito, USER_POOL_ID));
  const targets = input.householdIds ? all.filter((id) => input.householdIds!.includes(id)) : all;
  logger.info('Dispatching weekly plans', { week, households: targets });

  if (!input.skipFetch) {
    // One refresh for every market. A failure is logged (the ingest alarm fires) and the plans use the last snapshots.
    const response = await lambda.send(new InvokeCommand({ FunctionName: INGEST_FUNCTION_ARN, Payload: new TextEncoder().encode('{}') }));
    if (response.FunctionError) logger.warn('Offer refresh failed; planning with the previous offers', { error: response.FunctionError });
  }

  const started: string[] = [];
  const failed: { householdId: string; error: string }[] = [];
  for (const householdId of targets) {
    try {
      await lambda.send(
        new InvokeCommand({
          FunctionName: WEEKLY_PLAN_FUNCTION,
          InvocationType: 'Event',
          DurableExecutionName: weeklyExecutionName(week, householdId),
          Payload: new TextEncoder().encode(JSON.stringify({ householdId, week, skipFetch: true, sendEmail: input.sendEmail })),
        }),
      );
      started.push(householdId);
    } catch (error) {
      // An execution with this name already exists when the schedule retries; one household must not block the rest.
      failed.push({ householdId, error: (error as Error).message });
      logger.warn('Could not start weekly plan', { householdId, error });
    }
  }
  logger.info('Weekly plans started', { week, started, failed });
  if (started.length === 0 && failed.length > 0) throw new Error(`No weekly plan could be started: ${failed.map((f) => f.error).join('; ')}`);
  return { week, started, failed };
};
