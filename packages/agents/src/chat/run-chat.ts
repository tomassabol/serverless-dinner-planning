import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { Agent, BedrockModel, MemoryManager, type McpClient } from '@strands-agents/sdk';
import { createAgentCoreMemoryStores } from 'bedrock-agentcore/memory/strands';
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
  const history = toMessages(await loadTurns(memoryClient, ids));

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
    model: new BedrockModel({ modelId: config.modelId, region: config.region, maxTokens: 8_000, cacheConfig: { strategy: 'auto' } }),
    systemPrompt: chatSystemPrompt({ userName: request.userName, now: new Date() }),
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
