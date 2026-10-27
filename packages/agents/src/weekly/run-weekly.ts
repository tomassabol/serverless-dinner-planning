import { Agent, BedrockModel, type AgentResult, type McpClient } from '@strands-agents/sdk';
import {
  JudgeVerdictSchema,
  MealPlanDraftSchema,
  isoWeekDates,
  resolveWeekKey,
  type Dinner,
  type Issue,
  type JudgeVerdict,
  type MealPlan,
  type MealPlanDraft,
  type MealRecord,
  type Nutrition,
  type Offer,
  type Preferences,
} from '@dinner/shared';
import { checkPlan, hasBlocking } from '../checks.js';
import { callTool } from '../gateway.js';
import { JUDGE_SYSTEM_PROMPT, PLANNER_SYSTEM_PROMPT, judgeTask, plannerTask, revisionFeedback, type WeekContext } from './prompts.js';

export interface WeeklyConfig {
  region: string;
  plannerModelId: string;
  judgeModelId: string;
  maxRounds: number;
  /** Minimum judge score for approval. */
  passScore: number;
}

export interface WeeklyRequest {
  householdId: string;
  week?: string;
  now?: Date;
}

export type Logger = (message: string, data?: Record<string, unknown>) => void;

/** The weekly run only reads; write tools stay hidden (the Gateway interceptor also blocks them). */
export const WEEKLY_TOOL_FILTER = {
  allowed: ['search_offers', 'get_offer', 'nutrition_lookup', 'get_preferences', 'get_meal_history'].map(
    (tool) => `dinner-tools___${tool}`,
  ),
};

interface Round {
  draft: MealPlanDraft;
  nutrition: Map<string, Nutrition>;
  checks: Issue[];
  verdict: JudgeVerdict;
}

/** Plans a week with a planner agent, validates it in code, and loops with a judge agent until approved. */
export async function runWeekly(
  request: WeeklyRequest,
  config: WeeklyConfig,
  gateway: McpClient,
  log: Logger = () => {},
): Promise<MealPlan> {
  const now = request.now ?? new Date();
  const weekKey = resolveWeekKey(request.week ?? 'next', now);
  const dates = isoWeekDates(weekKey);

  const [preferences, { meals: history }] = await Promise.all([
    callTool<Preferences>(gateway, 'get_preferences'),
    callTool<{ meals: MealRecord[] }>(gateway, 'get_meal_history', { weeks: 8 }),
  ]);
  const ctx: WeekContext = { weekKey, dates, preferences, history };
  const traceAttributes = { 'household.id': request.householdId, 'plan.week': weekKey };

  const planner = new Agent({
    name: 'planner',
    model: new BedrockModel({ modelId: config.plannerModelId, region: config.region, maxTokens: 16_000, cacheConfig: { strategy: 'auto' } }),
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    tools: [gateway],
    printer: false,
    traceAttributes,
  });

  const usage: MealPlan['usage'] = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
  const addUsage = (result: AgentResult) => {
    const u = result.metrics?.latestAgentInvocation?.usage;
    usage.inputTokens += u?.inputTokens ?? 0;
    usage.outputTokens += u?.outputTokens ?? 0;
    usage.cacheReadInputTokens += u?.cacheReadInputTokens ?? 0;
    usage.cacheWriteInputTokens += u?.cacheWriteInputTokens ?? 0;
  };

  let best: Round | undefined;
  let rounds = 0;
  let prompt = plannerTask(ctx);

  for (let round = 1; round <= config.maxRounds; round++) {
    rounds = round;
    log('Planner round started', { round });
    const planned = await planner.invoke(prompt, { structuredOutputSchema: MealPlanDraftSchema, limits: { turns: 40 } });
    addUsage(planned);
    const draft = MealPlanDraftSchema.parse(planned.structuredOutput);

    const nutrition = await computeNutrition(gateway, draft, preferences.settings.servings);
    const offers = await fetchOffers(gateway, draft);
    const checks = checkPlan(draft, {
      week: { key: weekKey, dates },
      preferences,
      history,
      offers,
      nutrition,
      weekdays: new Set(dates.slice(0, 5)),
    });

    let verdict: JudgeVerdict;
    if (hasBlocking(checks)) {
      // Hard failures go straight back to the planner; no point paying for a review.
      verdict = { score: 0, approved: false, summary: 'The plan failed automated safety and consistency checks.', issues: [] };
    } else {
      const judge = new Agent({
        name: 'judge',
        model: new BedrockModel({ modelId: config.judgeModelId, region: config.region, maxTokens: 4_000 }),
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        printer: false,
        traceAttributes: { ...traceAttributes, 'judge.round': round },
      });
      const judged = await judge.invoke(judgeTask(ctx, draft, nutrition, checks), { structuredOutputSchema: JudgeVerdictSchema });
      addUsage(judged);
      verdict = JudgeVerdictSchema.parse(judged.structuredOutput);
    }

    log('Round finished', { round, score: verdict.score, approved: verdict.approved, checks: checks.length, blocking: hasBlocking(checks) });
    const current: Round = { draft, nutrition, checks, verdict };
    if (!hasBlocking(checks) && (!best || verdict.score > best.verdict.score)) best = current;

    if (!hasBlocking(checks) && verdict.approved && verdict.score >= config.passScore) {
      return toMealPlan(request.householdId, weekKey, 'approved', current, rounds, config, usage, preferences.settings.servings);
    }
    prompt = revisionFeedback(checks, hasBlocking(checks) ? null : verdict);
  }

  if (!best) throw new Error(`No plan without blocking issues after ${rounds} rounds`);
  return toMealPlan(request.householdId, weekKey, 'best_effort', best, rounds, config, usage, preferences.settings.servings);
}

/** Per-serving nutrition for each dinner, computed from Frida by the nutrition_lookup tool. */
async function computeNutrition(gateway: McpClient, plan: MealPlanDraft, servings: number) {
  const entries = await Promise.all(
    plan.dinners.map(async (dinner) => {
      const result = await callTool<{ total: Omit<Nutrition, 'unmatched'>; unmatched: string[] }>(gateway, 'nutrition_lookup', {
        items: dinner.ingredients.map((i) => ({ ingredient: i.name, grams: i.grams })),
      });
      const perServing = Object.fromEntries(
        Object.entries(result.total).map(([k, v]) => [k, Math.round((v / servings) * 10) / 10]),
      ) as Omit<Nutrition, 'unmatched'>;
      return [dinner.date, { ...perServing, kcal: Math.round(perServing.kcal), unmatched: result.unmatched }] as const;
    }),
  );
  return new Map<string, Nutrition>(entries);
}

async function fetchOffers(gateway: McpClient, plan: MealPlanDraft) {
  const ids = [...new Set(plan.dinners.flatMap((d) => d.ingredients.map((i) => i.offerId)).filter((id): id is string => !!id))];
  const offers = new Map<string, { validFrom: string; validTo: string }>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const offer = await callTool<Offer>(gateway, 'get_offer', { offerId: id });
        offers.set(id, { validFrom: offer.validFrom, validTo: offer.validTo });
      } catch {
        // Unknown ids are reported by the checks.
      }
    }),
  );
  return offers;
}

function toMealPlan(
  householdId: string,
  week: string,
  status: MealPlan['status'],
  round: Round,
  rounds: number,
  config: WeeklyConfig,
  usage: MealPlan['usage'],
  servings: number,
): MealPlan {
  const dinners: Dinner[] = round.draft.dinners
    .map((d) => ({ ...d, servings, nutrition: round.nutrition.get(d.date)! }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    householdId,
    week,
    status,
    dinners,
    notes: round.draft.notes,
    verdict: round.verdict,
    checks: round.checks,
    rounds,
    models: { planner: config.plannerModelId, judge: config.judgeModelId },
    usage,
    generatedAt: new Date().toISOString(),
  };
}
