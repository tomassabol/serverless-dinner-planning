import { z } from 'zod';
import type { WeeklyConfig } from './weekly/run-weekly.js';

const EnvSchema = z.object({
  AWS_REGION: z.string().default('eu-west-1'),
  PLANNER_MODEL_ID: z.string().default('eu.anthropic.claude-sonnet-4-6'),
  JUDGE_MODEL_ID: z.string().default('eu.anthropic.claude-sonnet-4-6'),
  MAX_ROUNDS: z.coerce.number().int().min(1).max(5).default(3),
  PASS_SCORE: z.coerce.number().min(0).max(10).default(7),
});

export function loadWeeklyConfig(env: Record<string, string | undefined> = process.env): WeeklyConfig {
  const parsed = EnvSchema.parse(env);
  return {
    region: parsed.AWS_REGION,
    plannerModelId: parsed.PLANNER_MODEL_ID,
    judgeModelId: parsed.JUDGE_MODEL_ID,
    maxRounds: parsed.MAX_ROUNDS,
    passScore: parsed.PASS_SCORE,
  };
}
