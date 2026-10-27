/**
 * AgentCore Runtime entry point for the weekly planner. Invoked with IAM (Step Functions / CLI),
 * so the householdId in the payload is trusted; it is forwarded to the Gateway as a header.
 */
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { HouseholdIdSchema } from '@dinner/shared';
import { z } from 'zod';
import { loadWeeklyConfig } from './config.js';
import { createGatewayClient } from './gateway.js';
import { WEEKLY_TOOL_FILTER, runWeekly } from './weekly/run-weekly.js';

const config = loadWeeklyConfig();
const gatewayUrl = z.string().url().parse(process.env.GATEWAY_URL);

const RequestSchema = z.object({
  action: z.literal('plan_week'),
  householdId: HouseholdIdSchema,
  week: z.string().regex(/^(current|next|\d{4}-W\d{2})$/).optional(),
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: RequestSchema,
    process: async (request, context) => {
      const log = context.log.child({ sessionId: context.sessionId, householdId: request.householdId });
      const gateway = createGatewayClient({
        url: gatewayUrl,
        region: config.region,
        householdId: request.householdId,
        caller: 'weekly',
        toolFilters: WEEKLY_TOOL_FILTER,
      });
      try {
        const plan = await runWeekly(request, config, gateway, (message, data) => log.info(data ?? {}, message));
        log.info({ status: plan.status, score: plan.verdict.score, rounds: plan.rounds, usage: plan.usage }, 'Plan ready');
        return { plan };
      } finally {
        await gateway.disconnect();
      }
    },
  },
});

app.run();
