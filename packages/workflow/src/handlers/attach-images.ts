/** Step Functions task: adds the generated image URLs to the stored plan and marks it ready. */
import { HouseholdIdSchema } from '@dinner/shared';
import { z } from 'zod';
import { ddb, env, logger } from '../clients.js';
import { PlanRepo } from '../plans.js';

const { TABLE_NAME } = env('TABLE_NAME');
const plans = new PlanRepo(ddb, TABLE_NAME);

const InputSchema = z.object({
  householdId: HouseholdIdSchema,
  week: z.string(),
  // A failed image comes back as null so one bad image never blocks the email.
  images: z.array(z.object({ date: z.iso.date(), imageUrl: z.string().nullable() }).nullable()),
});

export const handler = async (event: unknown) => {
  const { householdId, week, images } = InputSchema.parse(event);
  const plan = await plans.get(householdId, week);
  if (!plan) throw new Error(`No stored plan for ${householdId} ${week}`);

  const urls = new Map(images.filter((i) => i !== null).map((i) => [i.date, i.imageUrl]));
  await plans.put({
    ...plan,
    dinners: plan.dinners.map((d) => ({ ...d, imageUrl: urls.get(d.date) ?? d.imageUrl })),
    state: 'ready',
    updatedAt: new Date().toISOString(),
  });
  logger.info('Images attached', { householdId, week, images: urls.size });
  return { householdId, week };
};
