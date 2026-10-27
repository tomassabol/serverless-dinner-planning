import type { StoredPlan } from '@dinner/shared';
import { idToken } from './auth';

export type Rating = 'up' | 'down';
export type PlanDinner = StoredPlan['dinners'][number] & { rating: Rating | null };
export type Plan = Omit<StoredPlan, 'dinners' | 'usage' | 'executionId'> & { dinners: PlanDinner[] };

export interface Conversation {
  id: string;
  title: string;
  createdBy: string;
  updatedAt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export type ChatEvent =
  | { type: 'conversation'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { ...init.headers, authorization: await idToken(), 'content-type': 'application/json' },
  });
  return response;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getPlan(week: 'current' | 'next'): Promise<Plan | null> {
  const response = await request(`/plans/${week}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Loading the plan failed with ${response.status}`);
  return response.json();
}

export const rateMeal = (date: string, rating: Rating) =>
  json<{ date: string; rating: Rating }>(`/meals/${date}/rating`, { method: 'POST', body: JSON.stringify({ rating }) });

export const listConversations = () => json<{ conversations: Conversation[] }>('/conversations').then((r) => r.conversations);

export const getConversation = (id: string) =>
  json<{ messages: ChatMessage[] }>(`/conversations/${encodeURIComponent(id)}`).then((r) => r.messages);

/** Sends a message and calls onEvent for every Server-Sent Event the chat agent streams back. */
export async function streamChat(
  message: string,
  conversationId: string | null,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
) {
  const response = await request('/chat', {
    method: 'POST',
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
    headers: { accept: 'text/event-stream' },
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Chat failed with ${response.status}`);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data) as ChatEvent);
    }
  }
}

/** Stored user messages start with "[Name] "; split it off for display. */
export function splitSpeaker(text: string): { speaker: string | null; text: string } {
  const match = /^\[([^\]]{1,60})\]\s*/.exec(text);
  return match ? { speaker: match[1]!, text: text.slice(match[0].length) } : { speaker: null, text };
}
