import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { Agent, MemoryManager, type McpClient } from '@strands-agents/sdk';
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic';
import { createAgentCoreMemoryStores } from 'bedrock-agentcore/memory/strands';
import type { Preferences } from '@dinner/shared';
import { anthropicApiKey } from '../anthropic.js';
import { callTool } from '../gateway.js';
import { chatSystemPrompt } from './prompts.js';
import { loadTurns, toMessages } from './history.js';

export interface ChatConfig {
  region: string;
  modelId: string;
  memoryId: string;
}

export interface ChatRequest {
  householdId: string;
  userName: string;
  conversationId: string;
  message: string;
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } };

/** Long-term memory namespaces; must match the strategies on the AgentCore Memory resource. */
export const MEMORY_NAMESPACES = {
  preferences: '/households/{actorId}/preferences',
  facts: '/households/{actorId}/facts',
};

/**
 * One chat turn. Short-term history is reloaded from AgentCore Memory, long-term memories are
 * recalled into context, and the new turn is written back (which also drives LTM extraction).
 * The household is the memory actor, so both members share what the assistant has learned.
 */
export async function* runChat(
  request: ChatRequest,
  config: ChatConfig,
  gateway: McpClient,
  memoryClient = new BedrockAgentCoreClient({ region: config.region }),
): AsyncGenerator<ChatEvent> {
  const ids = { memoryId: config.memoryId, actorId: request.householdId, sessionId: request.conversationId };
  // The country and location shape the system prompt (currency, stores), so they are read up front.
  const [turns, preferences] = await Promise.all([loadTurns(memoryClient, ids), callTool<Preferences>(gateway, 'get_preferences')]);
  const history = toMessages(turns);

  const memory = new MemoryManager({
    stores: createAgentCoreMemoryStores({
      ...ids,
      client: memoryClient,
      namespaces: [
        { namespace: MEMORY_NAMESPACES.preferences, description: 'Taste preferences the household has expressed', writable: true },
        { namespace: MEMORY_NAMESPACES.facts, description: 'Facts about the household and past meals' },
      ],
      extraction: true,
    }),
    injection: true,
    searchToolConfig: false,
    addToolConfig: false,
  });

  const agent = new Agent({
    name: 'chat',
    model: new AnthropicModel({ modelId: config.modelId, apiKey: await anthropicApiKey(), maxTokens: 8_000, cacheConfig: { strategy: 'auto' } }),
    systemPrompt: chatSystemPrompt({ userName: request.userName, now: new Date(), market: preferences.market }),
    messages: history,
    tools: [gateway],
    plugins: [memory],
    printer: false,
    traceAttributes: { 'household.id': request.householdId, 'session.id': request.conversationId },
  });

  const stream = agent.stream(`[${request.userName}] ${request.message}`, { limits: { turns: 25 } });
  let result;
  while (true) {
    const next = await stream.next();
    if (next.done) {
      result = next.value;
      break;
    }
    const event = next.value;
    if (event.type === 'modelStreamUpdateEvent' && event.event.type === 'modelContentBlockDeltaEvent' && event.event.delta.type === 'textDelta') {
      yield { type: 'text', delta: event.event.delta.text };
    } else if (event.type === 'beforeToolCallEvent') {
      yield { type: 'tool', name: event.toolUse.name.replace(/^.*___/, '') };
    }
  }

  // Make sure this turn reaches AgentCore Memory before the runtime may be recycled.
  await memory.flush();
  const usage = result.metrics?.latestAgentInvocation?.usage;
  yield { type: 'done', usage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 } };
}
