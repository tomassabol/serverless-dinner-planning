/**
 * AgentCore Runtime entry point for the household chat. Invoked with IAM by the chat Lambda, which
 * takes the household and user name from the Cognito token, so the payload values are trusted.
 * Streams Server-Sent Events: text deltas, tool calls and a final usage event.
 */
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { HouseholdIdSchema } from '@dinner/shared';
import { z } from 'zod';
import { createGatewayClient } from './gateway.js';
import { runChat } from './chat/run-chat.js';

const env = z
  .object({
    AWS_REGION: z.string().default('eu-west-1'),
    GATEWAY_URL: z.string().url(),
    MEMORY_ID: z.string(),
    CHAT_MODEL_ID: z.string().default('eu.anthropic.claude-sonnet-4-6'),
  })
  .parse(process.env);

const RequestSchema = z.object({
  action: z.literal('chat'),
  householdId: HouseholdIdSchema,
  userName: z.string().min(1).max(60),
  conversationId: z.string().min(33).max(100),
  message: z.string().min(1).max(4000),
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: RequestSchema,
    process: async function* (request, context) {
      const log = context.log.child({ sessionId: context.sessionId, householdId: request.householdId });
      const gateway = createGatewayClient({
        url: env.GATEWAY_URL,
        region: env.AWS_REGION,
        householdId: request.householdId,
        caller: 'chat',
      });
      try {
        for await (const event of runChat(request, { region: env.AWS_REGION, modelId: env.CHAT_MODEL_ID, memoryId: env.MEMORY_ID }, gateway)) {
          if (event.type === 'tool') log.info({ tool: event.name }, 'Tool call');
          if (event.type === 'done') log.info({ usage: event.usage }, 'Chat turn finished');
          // @fastify/sse JSON-encodes `data` itself.
          yield { data: event };
        }
      } catch (error) {
        log.error({ err: error }, 'Chat turn failed');
        yield { data: { type: 'error', message: 'Something went wrong. Please try again.' } };
      } finally {
        await gateway.disconnect();
      }
    },
  },
});

app.run();
