/** Workflow step: adds the generated image URLs to the stored plan and marks it ready. */
import { ddb, env, logger } from '../clients.js';
import { PlanRepo } from '../plans.js';

const { TABLE_NAME } = env('TABLE_NAME');
const plans = new PlanRepo(ddb, TABLE_NAME);

/** A failed image comes back with a null URL so one bad image never blocks the email. */
export interface ImageResult {
  date: string;
  imageUrl: string | null;
}

export async function attachImages(householdId: string, week: string, images: ImageResult[]) {
  const plan = await plans.get(householdId, week);
  if (!plan) throw new Error(`No stored plan for ${householdId} ${week}`);

  const urls = new Map(images.map((i) => [i.date, i.imageUrl]));
  await plans.put({
    ...plan,
    dinners: plan.dinners.map((d) => ({ ...d, imageUrl: urls.get(d.date) ?? d.imageUrl })),
    state: 'ready',
    updatedAt: new Date().toISOString(),
  });
  logger.info('Images attached', { householdId, week, images: urls.size });
}
