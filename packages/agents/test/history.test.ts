import { describe, expect, it } from 'vitest';
import { toMessages, type ChatTurn } from '../src/chat/history.js';

const turn = (role: ChatTurn['role'], text: string, minute: number): ChatTurn => ({
  role,
  text,
  timestamp: `2026-11-03T10:${String(minute).padStart(2, '0')}:00.000Z`,
});

describe('toMessages', () => {
  it('starts with a user turn, merges same-role turns and drops a trailing user turn', () => {
    const messages = toMessages([
      turn('assistant', 'orphan greeting', 0),
      turn('user', '[Tomas] hi', 1),
      turn('assistant', 'Hello!', 2),
      turn('assistant', 'How can I help?', 3),
      turn('user', '[Ida] swap Wednesday', 4),
      turn('assistant', 'Done.', 5),
      turn('user', '[Tomas] unanswered', 6),
    ]);
    expect(messages).toEqual([
      { role: 'user', content: [{ text: '[Tomas] hi' }] },
      { role: 'assistant', content: [{ text: 'Hello!\n\nHow can I help?' }] },
      { role: 'user', content: [{ text: '[Ida] swap Wednesday' }] },
      { role: 'assistant', content: [{ text: 'Done.' }] },
    ]);
  });

  it('handles an empty conversation', () => {
    expect(toMessages([])).toEqual([]);
  });
});
