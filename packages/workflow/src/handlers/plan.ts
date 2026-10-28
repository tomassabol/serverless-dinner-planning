/** Weekly workflow task (chained invoke): runs the weekly planner/judge runtime and returns the validated plan. */
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { HouseholdIdSchema, MealPlanSchema } from '@dinner/shared';
import { z } from 'zod';
import { env, logger, tracer } from '../clients.js';

const { RUNTIME_ARN } = env('RUNTIME_ARN');
const client = tracer.captureAWSv3Client(
  new BedrockAgentCoreClient({ requestHandler: { requestTimeout: 13 * 60_000 } }),
);

const InputSchema = z.object({
  householdId: HouseholdIdSchema,
  week: z.string().default('next'),
  /** Durable execution name; reused as the AgentCore session id so traces line up. */
  executionName: z.string(),
});

export const handler = async (event: unknown) => {
  const input = InputSchema.parse(event);
  const sessionId = `weekly-${input.executionName}`.padEnd(33, '0');
  logger.info('Invoking weekly runtime', { ...input, sessionId });

  const response = await client.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: RUNTIME_ARN,
      runtimeSessionId: sessionId,
      contentType: 'application/json',
      accept: 'application/json',
      payload: new TextEncoder().encode(
        JSON.stringify({ action: 'plan_week', householdId: input.householdId, week: input.week }),
      ),
    }),
  );
  const body = JSON.parse(await response.response!.transformToString()) as { plan?: unknown; error?: string };
  if (!body.plan) throw new Error(`Runtime returned no plan: ${JSON.stringify(body).slice(0, 500)}`);

  const plan = MealPlanSchema.parse(body.plan);
  logger.info('Plan received', { week: plan.week, status: plan.status, score: plan.verdict.score, rounds: plan.rounds });
  return plan;
};
