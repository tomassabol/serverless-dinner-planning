/**
 * Fetches and normalizes offers locally without writing to AWS.
 * Usage: pnpm --filter @dinner/ingest dry-run [--tag] [--near=<lat>,<lng>] [chainId ...]
 * Without --near it fetches the Danish chains; with --near (e.g. --near=57.71,11.97 for Göteborg) the
 * Swedish chains' nearest stores. --tag classifies a 40-offer sample per chain with Claude (ANTHROPIC_API_KEY from the repo's .env).
 */
import Anthropic from '@anthropic-ai/sdk';
import { DANISH_MARKET, chainsFor, marketFor, type ChainId, type Offer } from '@dinner/shared';
import { AxfoodOfferSource } from './sources/axfood.js';
import { TjekOfferSource } from './sources/tjek.js';
import { OfferTagger } from './tagger.js';

const args = process.argv.slice(2);
const tag = args.includes('--tag');
const near = args.find((a) => a.startsWith('--near='))?.slice(7).split(',').map(Number);
const requested = args.filter((a) => !a.startsWith('--')) as ChainId[];
const market = near ? marketFor({ country: 'SE', location: { lat: near[0]!, lng: near[1]!, label: 'dry run' } })! : DANISH_MARKET;
const chains = chainsFor(market.country).filter((c) => requested.length === 0 || requested.includes(c.id));
const sources = { tjek: new TjekOfferSource(), axfood: new AxfoodOfferSource() };
const tagger = new OfferTagger(new Anthropic(), process.env.TAG_MODEL_ID ?? 'claude-haiku-4-5', (error) =>
  console.error('Tagging failed', error),
);

console.log(`Market ${market.key}`);
for (const chain of chains) {
  const source = sources[chain.source];
  const raw = await source.fetchRaw(chain, market);
  const valid = raw.map((item) => source.normalize(chain, item)).filter((o): o is Offer => o !== null);
  const withUnitPrice = valid.filter((o) => o.unitPrice).length;
  const where = valid.find((o) => o.catalogId)?.description?.split('. ').at(-1) ?? '';
  console.log(
    `${chain.name.padEnd(22)} fetched=${String(raw.length).padStart(4)} valid=${String(valid.length).padStart(4)} unitPrice=${withUnitPrice}${chain.source === 'axfood' ? ` (${where})` : ''}`,
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
