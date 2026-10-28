/**
 * Durable function that runs the weekly plan: refresh offers -> plan -> save -> photos -> attach -> email.
 * Each operation is checkpointed, so a replay after a suspend or crash skips work that already finished.
 * The planner and image Lambdas are chained invokes: this function is suspended (and not billed) while they run.
 */
import {
  StepSemantics,
  withDurableExecution,
  type DurableContext,
} from '@aws/durable-execution-sdk-js';
import { HouseholdIdSchema, MealPlanSchema } from '@dinner/shared';
import { z } from 'zod';
import { env } from '../clients.js';
import { attachImages, type ImageResult } from '../steps/attach-images.js';
import { sendPlanEmail } from '../steps/email.js';
import { savePlan } from '../steps/save-plan.js';

const { INGEST_FUNCTION_ARN, PLAN_FUNCTION_ARN, IMAGE_FUNCTION_ARN } = env(
  'INGEST_FUNCTION_ARN',
  'PLAN_FUNCTION_ARN',
  'IMAGE_FUNCTION_ARN',
);

/** Re-plans from chat pass `skipFetch: true`. */
const InputSchema = z.object({
  householdId: HouseholdIdSchema,
  week: z.string().default('next'),
  skipFetch: z.boolean().default(false),
  sendEmail: z.boolean().default(true),
});

type Dinner = { date: string; dish: string; description: string; cuisine: string };

const IMAGE_ATTEMPTS = 2;

export const handler = withDurableExecution(async (event: unknown, ctx: DurableContext) => {
  const input = InputSchema.parse(event);
  const executionArn = ctx.executionContext.durableExecutionArn;

  if (!input.skipFetch) await ctx.invoke('refresh-offers', INGEST_FUNCTION_ARN, {});

  // A run costs model tokens, so a failed plan fails the execution instead of being retried.
  const plan = MealPlanSchema.parse(
    await ctx.invoke('plan-week', PLAN_FUNCTION_ARN, {
      householdId: input.householdId,
      week: input.week,
      executionName: executionName(executionArn),
    }),
  );

  const saved = await ctx.step('save-plan', () => savePlan(plan, executionArn));

  const images = await ctx.map(
    'generate-images',
    saved.dinners,
    (item, dinner) => generateImage(item, saved.householdId, saved.week, dinner),
    { maxConcurrency: 3, itemNamer: (dinner) => dinner.date },
  );

  await ctx.step('attach-images', () => attachImages(saved.householdId, saved.week, images.getResults()));

  let recipients = 0;
  if (input.sendEmail) {
    // Never retried: a failure after SES accepted the message would email the household twice.
    recipients = await ctx.step('send-email', () => sendPlanEmail(saved.householdId, saved.week), {
      semantics: StepSemantics.AtMostOncePerRetry,
      retryStrategy: () => ({ shouldRetry: false }),
    });
  }

  ctx.logger.info('Weekly plan done', { householdId: saved.householdId, week: saved.week, recipients });
  return { householdId: saved.householdId, week: saved.week, recipients };
});

/** One failed image must not block the email: it is retried once, then recorded without a URL. */
async function generateImage(ctx: DurableContext, householdId: string, week: string, dinner: Dinner): Promise<ImageResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ctx.invoke<unknown, ImageResult>(`image-${attempt}`, IMAGE_FUNCTION_ARN, { householdId, week, dinner });
    } catch (error) {
      if (attempt >= IMAGE_ATTEMPTS) {
        ctx.logger.warn('Image failed', { date: dinner.date, error: (error as Error).message });
        return { date: dinner.date, imageUrl: null };
      }
      await ctx.wait(`image-backoff-${attempt}`, { seconds: 5 });
    }
  }
}

/** `.../durable-execution/<name>/<id>`: the name is the caller's execution name, or generated. */
const executionName = (executionArn: string) => executionArn.split('/').at(-2) ?? executionArn;
