import { BedrockAgentCoreClient, paginateListEvents } from '@aws-sdk/client-bedrock-agentcore';
import type { MessageData } from '@strands-agents/sdk';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

/** Reads a conversation's turns from AgentCore Memory (short-term memory events), oldest first. */
export async function loadTurns(
  client: BedrockAgentCoreClient,
  ids: { memoryId: string; actorId: string; sessionId: string },
  maxEvents = 100,
): Promise<ChatTurn[]> {
  const turns: ChatTurn[] = [];
  let seen = 0;
  for await (const page of paginateListEvents({ client }, { ...ids, includePayloads: true })) {
    for (const event of page.events ?? []) {
      for (const item of event.payload ?? []) {
        const conversational = item.conversational;
        const text = conversational?.content?.text;
        if (!text || (conversational.role !== 'USER' && conversational.role !== 'ASSISTANT')) continue;
        turns.push({
          role: conversational.role === 'USER' ? 'user' : 'assistant',
          text,
          timestamp: (event.eventTimestamp ?? new Date(0)).toISOString(),
        });
      }
      if (++seen >= maxEvents) break;
    }
    if (seen >= maxEvents) break;
  }
  return turns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Turns as Strands messages: starts with a user turn and merges consecutive turns of the same role. */
export function toMessages(turns: ChatTurn[]): MessageData[] {
  const messages: { role: 'user' | 'assistant'; texts: string[] }[] = [];
  for (const turn of turns) {
    const last = messages.at(-1);
    if (last?.role === turn.role) last.texts.push(turn.text);
    else if (messages.length > 0 || turn.role === 'user') messages.push({ role: turn.role, texts: [turn.text] });
  }
  // The model expects the history to end with an assistant turn before the new user message.
  if (messages.at(-1)?.role === 'user') messages.pop();
  return messages.map((m) => ({ role: m.role, content: [{ text: m.texts.join('\n\n') }] }));
}
