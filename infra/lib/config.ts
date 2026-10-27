import { RemovalPolicy } from 'aws-cdk-lib';
import { PROJECT_NAME, type Stage } from '@dinner/shared';

export const REGION = 'eu-west-1';

/** Small, cheap model used to classify offers at ingest time. */
export const TAG_MODEL_ID = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * Planner and judge model. Claude 5.x is not enabled for this account yet (2026-10-27);
 * switch to e.g. eu.anthropic.claude-sonnet-5-5 once Bedrock access is granted.
 */
export const AGENT_MODEL_ID = 'eu.anthropic.claude-sonnet-4-6';

export interface StageConfig {
  stage: Stage;
  /** Prefix for physical resource names, e.g. `dinner-prod`. */
  prefix: string;
  removalPolicy: RemovalPolicy;
  /** Monthly cost budget in USD for resources tagged with this project. */
  monthlyBudgetUsd: number;
  /** Share of X-Ray spans indexed as trace summaries (1% is free; volume here is tiny). */
  traceIndexingPercentage: number;
}

const stageConfigs: Record<Stage, Omit<StageConfig, 'stage' | 'prefix'>> = {
  prod: {
    removalPolicy: RemovalPolicy.RETAIN,
    monthlyBudgetUsd: 30,
    traceIndexingPercentage: 100,
  },
};

export function getStageConfig(stage: Stage): StageConfig {
  return { stage, prefix: `dinner-${stage}`, ...stageConfigs[stage] };
}

export const TAGS = (stage: Stage) => ({
  project: PROJECT_NAME,
  stage,
});
