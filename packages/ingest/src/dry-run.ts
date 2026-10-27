/**
 * Fetches and normalizes offers locally without writing to AWS.
 * Usage: pnpm --filter @dinner/ingest dry-run [--tag] [chainId ...]
 * --tag classifies a 40-offer sample per chain with Bedrock (uses AWS_PROFILE).
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { CHAINS, DEFAULT_CHAINS, type ChainId, type Offer } from '@dinner/shared';
import { TjekOfferSource } from './sources/tjek.js';
import { OfferTagger } from './tagger.js';

const args = process.argv.slice(2);
const tag = args.includes('--tag');
const requested = args.filter((a) => !a.startsWith('--')) as ChainId[];
const chains = requested.length ? CHAINS.filter((c) => requested.includes(c.id)) : DEFAULT_CHAINS;
const source = new TjekOfferSource();
const tagger = new OfferTagger(
  new BedrockRuntimeClient({ region: 'eu-west-1' }),
  process.env.TAG_MODEL_ID ?? 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
  (error) => console.error('Tagging failed', error),
);

for (const chain of chains) {
  const raw = await source.fetchRaw(chain);
  const valid = raw.map((item) => source.normalize(chain, item)).filter((o): o is Offer => o !== null);
  const withUnitPrice = valid.filter((o) => o.unitPrice).length;
  console.log(
    `${chain.name.padEnd(14)} fetched=${String(raw.length).padStart(4)} valid=${String(valid.length).padStart(4)} unitPrice=${withUnitPrice}`,
  );

  if (tag) {
    const sample = valid.slice(0, 40);
    const result = await tagger.tag(sample);
    console.log(`  tagged ${result.tags.size}/${sample.length}, tokens in=${result.inputTokens} out=${result.outputTokens}`);
    for (const offer of sample) {
      const t = result.tags.get(offer.id);
      console.log(`  ${(t?.category ?? 'UNTAGGED').padEnd(18)} ${String(t?.dinnerRelevant ?? '').padEnd(5)} ${(t?.canonicalIngredient ?? '').padEnd(22)} ${offer.heading.slice(0, 50)}`);
    }
  }
}
