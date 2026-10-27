import { RemovalPolicy } from 'aws-cdk-lib';
import { PROJECT_NAME, type Stage } from '@dinner/shared';

export const REGION = 'eu-west-1';

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
