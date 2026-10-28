/** Generates (or reuses) a photo for one dinner and returns its public URL. Called by the weekly workflow and chat edits. */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { HouseholdIdSchema } from '@dinner/shared';
import { z } from 'zod';
import { ddb, env, logger, tracer } from '../clients.js';
import { IMAGE_MODEL_ID, IMAGE_MODEL_REGION, imageKey, imagePrompt } from '../images.js';
import { PlanRepo } from '../plans.js';

const { MEDIA_BUCKET, MEDIA_BASE_URL, TABLE_NAME } = env('MEDIA_BUCKET', 'MEDIA_BASE_URL', 'TABLE_NAME');
const plans = new PlanRepo(ddb, TABLE_NAME);
const s3 = tracer.captureAWSv3Client(new S3Client({}));
const bedrock = tracer.captureAWSv3Client(new BedrockRuntimeClient({ region: IMAGE_MODEL_REGION }));

const InputSchema = z.object({
  householdId: HouseholdIdSchema,
  week: z.string(),
  dinner: z.object({ date: z.iso.date(), dish: z.string(), description: z.string(), cuisine: z.string() }),
  /** Set by the chat tools: write the URL into the stored plan (the workflow attaches images itself). */
  attach: z.boolean().default(false),
});

const StabilityResponse = z.object({ images: z.array(z.string()).min(1), finish_reasons: z.array(z.string().nullable()) });

export const handler = async (event: unknown) => {
  const { householdId, week, dinner, attach } = InputSchema.parse(event);
  const key = imageKey(householdId, week, dinner);
  const url = `${MEDIA_BASE_URL}/${key}`;

  if (await exists(key)) {
    logger.info('Reusing image', { key });
  } else {
    await generate(key, dinner);
  }
  if (attach) await attachToPlan(householdId, week, dinner, url);
  return { date: dinner.date, imageUrl: url };
};

async function generate(key: string, dinner: z.infer<typeof InputSchema>['dinner']) {
  const { prompt, negativePrompt } = imagePrompt(dinner);
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: IMAGE_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ prompt, negative_prompt: negativePrompt, aspect_ratio: '3:2', output_format: 'jpeg' }),
    }),
  );
  const result = StabilityResponse.parse(JSON.parse(new TextDecoder().decode(response.body)));
  if (result.finish_reasons[0]) throw new Error(`Image generation stopped: ${result.finish_reasons[0]}`);

  await s3.send(
    new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: key,
      Body: Buffer.from(result.images[0]!, 'base64'),
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  logger.info('Image generated', { key });
}

/** Only attaches if the day still has the same dish, so a stale request can't overwrite a newer change. */
async function attachToPlan(householdId: string, week: string, dinner: { date: string; dish: string }, url: string) {
  const plan = await plans.get(householdId, week);
  const target = plan?.dinners.find((d) => d.date === dinner.date && d.dish === dinner.dish);
  if (!plan || !target) return;
  await plans.put({
    ...plan,
    dinners: plan.dinners.map((d) => (d === target ? { ...d, imageUrl: url } : d)),
    updatedAt: new Date().toISOString(),
  });
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (error instanceof NotFound) return false;
    throw error;
  }
}
