import { describe, expect, it, vi } from 'vitest';
import { DANISH_MARKET, getChain, marketFor, type Chain, type Offer, type OfferTags } from '@dinner/shared';
import { runIngest, type IngestDeps } from '../src/ingest.js';
import type { OfferSource } from '../src/sources/types.js';
import type { OfferStore } from '../src/store.js';
import type { OfferTagger } from '../src/tagger.js';

const now = new Date('2026-10-28T05:00:00Z');

const offer = (id: string, chain: Chain, validFrom: string, validTo: string): Offer => ({
  id,
  source: 'tjek',
  chain: chain.id,
  heading: id,
  description: null,
  price: 10,
  prePrice: null,
  currency: 'DKK',
  amount: null,
  unitPrice: null,
  validFrom,
  validTo,
  publishedAt: null,
  imageUrl: null,
  catalogId: null,
  tags: null,
});

const tags = (category: OfferTags['category']): OfferTags => ({
  category,
  canonicalIngredient: category === 'non_food' ? '' : 'x',
  dinnerRelevant: category !== 'non_food',
  model: 'test',
  taggedAt: now.toISOString(),
});

function setup(existing: Map<string, OfferTags | null>) {
  const netto = getChain('netto');
  const lidl = getChain('lidl');
  const offers: Record<string, Offer[]> = {
    netto: [
      offer('known', netto, '2026-10-24T22:00:00.000Z', '2026-10-30T22:59:59.000Z'),
      offer('fresh', netto, '2026-10-24T22:00:00.000Z', '2026-10-30T22:59:59.000Z'),
      offer('diapers', netto, '2026-10-24T22:00:00.000Z', '2026-10-30T22:59:59.000Z'),
    ],
    lidl: [offer('next-week', lidl, '2026-11-01T23:00:00.000Z', '2026-11-07T22:59:59.000Z')],
    'ica-nara': [offer('ica-near', getChain('ica-nara'), '2026-10-25T23:00:00.000Z', '2026-11-01T22:59:59.000Z')],
    hemkop: [offer('hemkop-near', getChain('hemkop'), '2026-10-25T23:00:00.000Z', '2026-11-01T22:59:59.000Z')],
  };

  const source: OfferSource = {
    name: 'fake',
    fetchRaw: async (chain, market) => {
      if (chain.id === 'rema1000') throw new Error('boom');
      if (chain.country === 'SE' && !market.location) throw new Error('no location');
      return offers[chain.id] ?? [];
    },
    normalize: (_chain, raw) => ({ ...(raw as Offer) }),
  };

  const putJson = vi.fn(async () => {});
  const putOffers = vi.fn(async (_offers: Offer[]) => {});
  const store = { putJson, putOffers, getExistingTags: async () => existing } as unknown as OfferStore;

  const tag = vi.fn(async (toTag: Offer[]) => ({
    tags: new Map(toTag.map((o) => [o.id, tags(o.id === 'diapers' ? 'non_food' : 'meat')])),
    inputTokens: 100,
    outputTokens: 50,
    failedBatches: 0,
  }));
  const tagger = { tag } as unknown as OfferTagger;

  const deps: IngestDeps = { sources: { tjek: source, axfood: source }, store, tagger, log: () => {} };
  return { deps, putJson, putOffers, tag };
}

describe('runIngest', () => {
  it('tags only unknown offers and writes week snapshots without non-food', async () => {
    const { deps, putJson, putOffers, tag } = setup(new Map([['known', tags('fish')]]));

    const result = await runIngest(deps, { chains: ['netto', 'lidl', 'rema1000'], now });

    expect(tag).toHaveBeenCalledOnce();
    expect(tag.mock.calls[0]![0].map((o) => o.id).sort()).toEqual(['diapers', 'fresh', 'next-week']);
    expect(putOffers.mock.calls[0]![0].map((o: Offer) => o.id).sort()).toEqual(['diapers', 'fresh', 'next-week']);

    expect(result.chains.find((c) => c.chain === 'rema1000')?.error).toBe('boom');
    expect(result.newOffers).toBe(3);
    expect(result.snapshots).toEqual([
      { market: 'dk', week: '2026-W44', key: 'snapshots/dk/2026-W44/offers.json', offers: 2 },
      { market: 'dk', week: '2026-W45', key: 'snapshots/dk/2026-W45/offers.json', offers: 1 },
    ]);

    const rawKeys = putJson.mock.calls.map((call) => (call as unknown[])[0]);
    expect(rawKeys).toContain('raw/fake/2026-10-28/dk/netto.json');
  });

  it('re-tags offers stored without tags and stores them once tagged', async () => {
    const { deps, putOffers, tag } = setup(new Map([['fresh', null]]));

    await runIngest(deps, { chains: ['netto'], now, skipTagging: false });

    expect(tag.mock.calls[0]![0].map((o) => o.id).sort()).toEqual(['diapers', 'fresh', 'known']);
    expect(putOffers.mock.calls[0]![0].map((o: Offer) => o.id).sort()).toEqual(['diapers', 'fresh', 'known']);
  });

  it('writes a separate snapshot per market with only that market\'s chains', async () => {
    const { deps, putJson } = setup(new Map());
    const goteborg = marketFor({ country: 'SE', location: { lat: 57.7089, lng: 11.9746, label: 'Göteborg' } })!;

    const result = await runIngest(deps, { markets: [DANISH_MARKET, goteborg], chains: ['netto', 'ica-nara', 'hemkop'], now });

    expect(result.chains.map((c) => `${c.market}/${c.chain}`)).toEqual(['dk/netto', 'se-57.71_11.97/ica-nara', 'se-57.71_11.97/hemkop']);
    const snapshot = (key: string) =>
      (putJson.mock.calls.find((call) => (call as unknown[])[0] === key) as unknown[] | undefined)?.[1] as { offers: Offer[]; country: string } | undefined;
    expect(snapshot('snapshots/dk/2026-W44/offers.json')!.offers.map((o) => o.id).sort()).toEqual(['fresh', 'known']);
    const swedish = snapshot('snapshots/se-57.71_11.97/2026-W44/offers.json')!;
    expect(swedish.country).toBe('SE');
    expect(swedish.offers.map((o) => o.id).sort()).toEqual(['hemkop-near', 'ica-near']);
  });

  it('keeps the previous snapshot of a market whose chains all failed', async () => {
    const { deps } = setup(new Map());
    const result = await runIngest(deps, { markets: [DANISH_MARKET], chains: ['netto', 'rema1000'], now });
    expect(result.snapshots.every((s) => s.market === 'dk')).toBe(true);

    const failing = await runIngest(deps, { markets: [DANISH_MARKET, { key: 'se-x', country: 'SE', location: null }], chains: ['netto', 'ica-nara'], now });
    expect(failing.snapshots.some((s) => s.market === 'se-x')).toBe(false);
  });

  it('fails when every chain fails', async () => {
    const { deps } = setup(new Map());
    await expect(runIngest(deps, { chains: ['rema1000'], now })).rejects.toThrow('every chain');
  });
});
