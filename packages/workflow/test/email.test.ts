import { describe, expect, it } from 'vitest';
import type { StoredPlan } from '@dinner/shared';
import { renderPlanEmail } from '../src/email/render.js';
import { buildShoppingList } from '../src/shopping.js';
import { dinner, offer } from './fixtures.js';

const dinners = [
  { ...dinner('2026-11-02', 'Tacos with <script>', [{ name: 'minced beef', grams: 500, offerId: 'a' }, { name: 'tortillas', grams: 300, offerId: null }]), imageUrl: 'https://cdn.example/images/a.jpg' },
  { ...dinner('2026-11-04', 'Salmon with potatoes', [{ name: 'salmon', grams: 400, offerId: null }, { name: 'potatoes', grams: 500, offerId: null }]), imageUrl: null },
];

const plan: StoredPlan = {
  householdId: 'home',
  week: '2026-W45',
  status: 'approved',
  dinners,
  notes: '',
  verdict: { score: 8, approved: true, summary: 'A cosy week & good value.', issues: [] },
  checks: [],
  rounds: 1,
  models: { planner: 'p', judge: 'j' },
  usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
  generatedAt: '2026-11-01T16:00:00.000Z',
  shoppingList: buildShoppingList(dinners, new Map([['a', offer('a', 'netto', 'Hakket oksekød', 39)]])),
  state: 'ready',
  executionId: null,
  updatedAt: '2026-11-01T16:05:00.000Z',
};

describe('renderPlanEmail', () => {
  const { subject, html, text } = renderPlanEmail(plan);

  it('builds a subject from the dishes', () => {
    expect(subject).toBe('Week 45 dinners: Tacos, Salmon');
  });

  it('escapes model-generated text', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('Tacos with &lt;script&gt;');
    expect(html).toContain('A cosy week &amp; good value.');
  });

  it('shows images, store tags, the shopping list and attribution', () => {
    expect(html).toContain('src="https://cdn.example/images/a.jpg"');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('Netto offer');
    expect(html).toContain('Hakket oksekød');
    expect(html).toContain('Monday 2 Nov');
    expect(html).toContain('Frida');
    expect(text).toContain('MONDAY 2 NOV: Tacos with <script>');
    expect(text).toContain('Also needed: potatoes 500 g, salmon 400 g, tortillas 300 g');
  });
});
