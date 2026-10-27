import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  getConversation,
  listConversations,
  splitSpeaker,
  streamChat,
  type ChatMessage,
  type Conversation,
} from '../api';
import { relativeTime } from './format';

/** Tools that change the plan; after them the plan view reloads. */
const PLAN_CHANGING_TOOLS = new Set(['replace_dinner', 'remove_dinner', 'rate_meal', 'update_preferences', 'replan_week']);

const TOOL_LABELS: Record<string, string> = {
  search_offers: 'Looking through this week’s offers',
  get_offer: 'Checking an offer',
  nutrition_lookup: 'Calculating nutrition',
  get_preferences: 'Reading your preferences',
  update_preferences: 'Saving your preferences',
  get_meal_history: 'Looking at recent dinners',
  get_plan: 'Opening the plan',
  replace_dinner: 'Updating the plan',
  remove_dinner: 'Updating the plan',
  rate_meal: 'Saving your rating',
  replan_week: 'Starting a new plan',
};

const SUGGESTIONS = [
  "What's for dinner tonight?",
  'Swap Wednesday for something vegetarian',
  "We don't like mushrooms",
  'Which store should I go to this week?',
];

interface Props {
  userName: string;
  onPlanChanged: () => void;
}

interface DisplayMessage extends ChatMessage {
  status?: string;
  pending?: boolean;
}

export function ChatView({ userName, onPlanChanged }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await listConversations());
    } catch {
      // The sidebar is optional; the chat still works.
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
    return () => abortRef.current?.abort();
  }, [refreshConversations]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const openConversation = async (id: string) => {
    if (busy) return;
    setShowHistory(false);
    setActiveId(id);
    setError(null);
    setMessages([]);
    try {
      setMessages(await getConversation(id));
    } catch {
      setError('Could not load this conversation.');
    }
  };

  const newConversation = () => {
    if (busy) return;
    setShowHistory(false);
    setActiveId(null);
    setMessages([]);
    setError(null);
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    const now = new Date().toISOString();
    setMessages((m) => [
      ...m,
      { role: 'user', text: `[${userName}] ${message}`, timestamp: now },
      { role: 'assistant', text: '', timestamp: now, pending: true, status: 'Thinking' },
    ]);

    const updateLast = (update: (m: DisplayMessage) => DisplayMessage) =>
      setMessages((all) => [...all.slice(0, -1), update(all.at(-1)!)]);

    let changedPlan = false;
    abortRef.current = new AbortController();
    try {
      await streamChat(
        message,
        activeId,
        (event) => {
          if (event.type === 'conversation') setActiveId(event.id);
          else if (event.type === 'text') updateLast((m) => ({ ...m, text: m.text + event.delta, status: undefined }));
          else if (event.type === 'tool') {
            if (PLAN_CHANGING_TOOLS.has(event.name)) changedPlan = true;
            updateLast((m) => ({ ...m, text: m.text ? `${m.text}\n\n` : m.text, status: TOOL_LABELS[event.name] ?? 'Working on it' }));
          } else if (event.type === 'error') setError(event.message);
        },
        abortRef.current.signal,
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError('The assistant could not answer. Please try again.');
    } finally {
      updateLast((m) => ({ ...m, pending: false, status: undefined, text: m.text.trim() }));
      setBusy(false);
      void refreshConversations();
      if (changedPlan) onPlanChanged();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  return (
    <div className={`chat${showHistory ? ' chat-show-history' : ''}`}>
      <aside className="conversations" aria-label="Conversations">
        <button className="primary new-chat" onClick={newConversation} disabled={busy}>
          + New chat
        </button>
        <ul>
          {conversations.map((c) => (
            <li key={c.id}>
              <button className={c.id === activeId ? 'active' : ''} onClick={() => void openConversation(c.id)} disabled={busy}>
                <span className="conversation-title">{c.title}</span>
                <span className="muted small">
                  {c.createdBy} · {relativeTime(c.updatedAt)}
                </span>
              </button>
            </li>
          ))}
          {conversations.length === 0 && <li className="muted small padded">No conversations yet.</li>}
        </ul>
      </aside>

      <section className="chat-main">
        <div className="chat-toolbar">
          <button className="link" onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? 'Close history' : 'History'}
          </button>
          <button className="link" onClick={newConversation} disabled={busy}>
            New chat
          </button>
        </div>

        <div className="messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="chat-empty">
              <h2>Hi {userName} 👋</h2>
              <p className="muted">Ask about the plan, swap a dinner, or tell me what you like and don't like.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, index) => {
            const { speaker, text } = m.role === 'user' ? splitSpeaker(m.text) : { speaker: null, text: m.text };
            return (
              <div key={`${m.timestamp}-${index}`} className={`message message-${m.role}`}>
                {speaker && <div className="speaker">{speaker}</div>}
                <div className="bubble">
                  {m.role === 'assistant' ? <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown> : <p>{text}</p>}
                  {m.status && (
                    <div className="status">
                      <span className="dots" aria-hidden />
                      {m.status}…
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form className="composer" onSubmit={onSubmit}>
          <textarea
            rows={1}
            value={input}
            placeholder="Ask about dinner…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message"
            maxLength={4000}
          />
          <button className="primary" disabled={busy || !input.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </form>
      </section>
    </div>
  );
}
