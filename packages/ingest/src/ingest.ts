import { CHAINS, DEFAULT_CHAINS, currentAndNextWeek, overlaps, type Chain, type ChainId, type Offer } from '@dinner/shared';
import type { OfferSource } from './sources/types.js';
import type { OfferStore } from './store.js';
import type { OfferTagger, TaggerResult } from './tagger.js';

export interface IngestOptions {
  chains?: ChainId[];
  /** Skip the Bedrock tagging step (offers are stored untagged and tagged on a later run). */
  skipTagging?: boolean;
  now?: Date;
}

export interface ChainResult {
  chain: ChainId;
  fetched: number;
  invalid: number;
  error?: string;
}

export interface IngestResult {
  chains: ChainResult[];
  totalOffers: number;
  newOffers: number;
  tagged: number;
  untagged: number;
  tagInputTokens: number;
  tagOutputTokens: number;
  failedTagBatches: number;
  snapshots: { week: string; key: string; offers: number }[];
}

export interface IngestDeps {
  source: OfferSource;
  store: OfferStore;
  tagger: OfferTagger;
  log: (message: string, data?: Record<string, unknown>) => void;
}

export async function runIngest(deps: IngestDeps, options: IngestOptions = {}): Promise<IngestResult> {
  const { source, store, tagger, log } = deps;
  const now = options.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const chains: readonly Chain[] = options.chains
    ? CHAINS.filter((c) => options.chains!.includes(c.id))
    : DEFAULT_CHAINS;

  const chainResults: ChainResult[] = [];
  const offers = new Map<string, Offer>();

  // Chains are fetched one at a time to keep the load on Tjek low.
  for (const chain of chains) {
    try {
      const raw = await source.fetchRaw(chain);
      await store.putJson(`raw/${source.name}/${day}/${chain.id}.json`, raw);

      let invalid = 0;
      for (const item of raw) {
        const offer = source.normalize(chain, item);
        if (offer) offers.set(offer.id, offer);
        else invalid++;
      }
      chainResults.push({ chain: chain.id, fetched: raw.length, invalid });
      log('Fetched chain', { chain: chain.id, fetched: raw.length, invalid });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      chainResults.push({ chain: chain.id, fetched: 0, invalid: 0, error: message });
      log('Chain fetch failed', { chain: chain.id, error: message });
    }
  }

  if (chainResults.every((r) => r.error)) {
    throw new Error('Fetching failed for every chain');
  }

  // Reuse tags from earlier runs; only new or previously untagged offers go to the model.
  const existing = await store.getExistingTags([...offers.keys()]);
  const toWrite: Offer[] = [];
  const toTag: Offer[] = [];
  for (const offer of offers.values()) {
    const tags = existing.get(offer.id);
    if (tags) {
      offer.tags = tags;
    } else {
      toTag.push(offer);
      if (!existing.has(offer.id)) toWrite.push(offer);
    }
  }

  let tagResult: TaggerResult = { tags: new Map(), inputTokens: 0, outputTokens: 0, failedBatches: 0 };
  if (!options.skipTagging && toTag.length > 0) {
    tagResult = await tagger.tag(toTag);
    for (const offer of toTag) {
      const tags = tagResult.tags.get(offer.id);
      if (tags) {
        offer.tags = tags;
        if (existing.has(offer.id)) toWrite.push(offer);
      }
    }
  }

  await store.putOffers(toWrite);

  const snapshots: IngestResult['snapshots'] = [];
  const all = [...offers.values()];
  for (const week of currentAndNextWeek(now)) {
    const weekOffers = all
      .filter((o) => overlaps(o.validFrom, o.validTo, week))
      // Keep untagged offers so a failed tagging run still leaves usable data.
      .filter((o) => o.tags === null || o.tags.category !== 'non_food');
    const key = `snapshots/${week.key}/offers.json`;
    await store.putJson(key, {
      week: week.key,
      weekStart: week.start.toISOString(),
      weekEnd: week.end.toISOString(),
      generatedAt: now.toISOString(),
      offers: weekOffers,
    });
    snapshots.push({ week: week.key, key, offers: weekOffers.length });
  }

  return {
    chains: chainResults,
    totalOffers: offers.size,
    newOffers: [...offers.keys()].filter((id) => !existing.has(id)).length,
    tagged: tagResult.tags.size,
    untagged: all.filter((o) => o.tags === null).length,
    tagInputTokens: tagResult.inputTokens,
    tagOutputTokens: tagResult.outputTokens,
    failedTagBatches: tagResult.failedBatches,
    snapshots,
  };
}
