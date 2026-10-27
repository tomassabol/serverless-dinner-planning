import { BedrockRuntimeClient, ConverseCommand, type Tool } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { OFFER_CATEGORIES, OfferCategorySchema, type Offer, type OfferTags } from '@dinner/shared';

const BATCH_SIZE = 40;
const CONCURRENCY = 4;
const DESCRIPTION_LIMIT = 140;

const SYSTEM_PROMPT = `You classify Danish supermarket offers for a dinner-planning app.
For every offer, call record_tags once with one entry per offer id:
- category: one of ${OFFER_CATEGORIES.join(', ')}.
  meat = beef, pork, lamb, minced meat, sausages, bacon, cold cuts. poultry = chicken, turkey, duck.
  vegetarian_protein = eggs, tofu, beans, lentils, plant-based meat. carbs = pasta, rice, potatoes, bread, tortillas, noodles.
  pantry = oils, spices, sauces, canned goods, stock, flour, sugar. ready_meal = pizza, lasagne and other ready-to-heat meals.
  snacks = sweets, chips, ice cream, cakes, biscuits. beverages = all drinks including alcohol and coffee.
  non_food = anything not eaten (cleaning, hygiene, diapers, pet food, household, clothing, electronics).
- canonicalIngredient: short lowercase English name of the main ingredient (e.g. "pork tenderloin", "minced beef", "salmon fillet", "broccoli"). If the offer says "X eller Y", name the first food option. Empty string for non_food.
- dinnerRelevant: true if a home cook could use it as part of a dinner (proteins, vegetables, carbs, dairy like cheese or cream, cooking pantry items). False for snacks, beverages, breakfast cereals, baby food and non_food.
Classify every id you are given. Do not skip any.`;

const TagBatchSchema = z.object({
  tags: z.array(
    z.object({
      id: z.string(),
      category: OfferCategorySchema,
      canonicalIngredient: z.string(),
      dinnerRelevant: z.boolean(),
    }),
  ),
});

const RECORD_TAGS_TOOL: Tool = {
  toolSpec: {
    name: 'record_tags',
    description: 'Record the classification of each offer.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                category: { type: 'string', enum: [...OFFER_CATEGORIES] },
                canonicalIngredient: { type: 'string' },
                dinnerRelevant: { type: 'boolean' },
              },
              required: ['id', 'category', 'canonicalIngredient', 'dinnerRelevant'],
            },
          },
        },
        required: ['tags'],
      },
    },
  },
};

export interface TaggerResult {
  tags: Map<string, OfferTags>;
  inputTokens: number;
  outputTokens: number;
  failedBatches: number;
}

export class OfferTagger {
  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly modelId: string,
    private readonly onError: (error: unknown, offerIds: string[]) => void = () => {},
  ) {}

  async tag(offers: Offer[]): Promise<TaggerResult> {
    const result: TaggerResult = { tags: new Map(), inputTokens: 0, outputTokens: 0, failedBatches: 0 };
    const batches = chunk(offers, BATCH_SIZE);

    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++]!;
        try {
          await this.tagBatch(batch, result);
        } catch (error) {
          // Untagged offers are retried on the next run.
          result.failedBatches++;
          this.onError(error, batch.map((o) => o.id));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
    return result;
  }

  private async tagBatch(batch: Offer[], result: TaggerResult) {
    const lines = batch.map((o) => {
      const description = (o.description ?? '').replace(/\s+/g, ' ').slice(0, DESCRIPTION_LIMIT);
      return `${o.id} | ${o.heading} | ${description}`;
    });

    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ text: `Offers (id | heading | description):\n${lines.join('\n')}` }] }],
        toolConfig: { tools: [RECORD_TAGS_TOOL], toolChoice: { tool: { name: 'record_tags' } } },
        inferenceConfig: { maxTokens: 8000, temperature: 0 },
      }),
    );

    result.inputTokens += response.usage?.inputTokens ?? 0;
    result.outputTokens += response.usage?.outputTokens ?? 0;

    const toolUse = response.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
    const parsed = TagBatchSchema.parse(toolUse?.input);
    const ids = new Set(batch.map((o) => o.id));
    const taggedAt = new Date().toISOString();

    for (const tag of parsed.tags) {
      if (!ids.has(tag.id)) continue;
      result.tags.set(tag.id, {
        category: tag.category,
        canonicalIngredient: tag.canonicalIngredient.trim().toLowerCase(),
        dinnerRelevant: tag.category === 'non_food' ? false : tag.dinnerRelevant,
        model: this.modelId,
        taggedAt,
      });
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
