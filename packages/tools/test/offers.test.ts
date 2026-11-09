import { describe, expect, it } from 'vitest';
import { NoSuchKey, type S3Client } from '@aws-sdk/client-s3';
import type { Offer, OfferTags } from '@dinner/shared';
import { OfferCatalog } from '../src/offers.js';

const tags = (category: OfferTags['category'], ingredient: string, dinnerRelevant = true): OfferTags => ({
  category,
  canonicalIngredient: ingredient,
  dinnerRelevant,
  model: 'test',
  taggedAt: '2026-10-27T00:00:00.000Z',
});

const offer = (id: string, heading: string, t: OfferTags, extra: Partial<Offer> = {}): Offer => ({
  id,
  source: 'tjek',
  chain: 'netto',
  heading,
  description: null,
  price: 50,
  prePrice: null,
  currency: 'DKK',
  amount: null,
  unitPrice: null,
  validFrom: '2026-10-31T23:00:00.000Z',
  validTo: '2026-11-06T22:59:59.000Z',
  publishedAt: null,
  imageUrl: null,
  catalogId: null,
  tags: t,
  ...extra,
});

const offers = [
  offer('1', 'Dansk kyllingebrystfilet', tags('poultry', 'chicken breast fillet')),
  offer('2', 'Laksefilet med skind', tags('fish', 'salmon fillet'), { chain: 'lidl', description: 'Fast lav pris' }),
  offer('3', 'Lays chips', tags('snacks', 'chips', false)),
  offer('4', 'Hakket oksekød', tags('meat', 'minced beef'), { validTo: '2026-11-02T22:59:59.000Z' }),
];

const swedish = [offer('se-1', 'Kycklingbröstfilé', tags('poultry', 'chicken breast fillet'), { chain: 'ica-nara', currency: 'SEK' })];
const snapshots: Record<string, Offer[]> = {
  'snapshots/dk/2026-W45/offers.json': offers,
  'snapshots/se-57.71_11.97/2026-W45/offers.json': swedish,
  // Danish snapshots written before markets existed.
  'snapshots/2026-W46/offers.json': offers.slice(0, 1),
};
const s3 = {
  send: async (command: { input: { Key: string } }) => {
    const found = snapshots[command.input.Key];
    if (!found) throw new NoSuchKey({ message: 'missing', $metadata: {} });
    return { Body: { transformToString: async () => JSON.stringify({ offers: found }) } };
  },
} as unknown as S3Client;

// Wednesday of week 44, so "next" is week 45.
const catalog = new OfferCatalog(s3, 'bucket', () => new Date('2026-10-28T12:00:00Z'));

describe('OfferCatalog', () => {
  it('resolves relative weeks in Danish time', () => {
    expect(catalog.resolveWeek('current')).toBe('2026-W44');
    expect(catalog.resolveWeek('next')).toBe('2026-W45');
    expect(catalog.resolveWeek('2026-W46')).toBe('2026-W46');
  });

  it('finds offers by English ingredient or Danish heading', async () => {
    expect((await catalog.search({ week: 'next', query: 'salmon' }, 'dk')).offers.map((o) => o.id)).toEqual(['2']);
    expect((await catalog.search({ week: 'next', query: 'kylling' }, 'dk')).offers.map((o) => o.id)).toEqual(['1']);
  });

  it('falls back to fuzzy matching for typos', async () => {
    expect((await catalog.search({ week: 'next', query: 'samlon' }, 'dk')).offers.map((o) => o.id)).toEqual(['2']);
  });

  it('hides non-dinner items by default and flags everyday prices', async () => {
    const result = await catalog.search({ week: 'next' }, 'dk');
    expect(result.offers.map((o) => o.id)).toEqual(['1', '2', '4']);
    expect(result.offers.find((o) => o.id === '2')?.everydayPrice).toBe(true);
  });

  it('keeps markets apart and reads legacy Danish snapshots', async () => {
    expect((await catalog.search({ week: 'next', query: 'chicken' }, 'se-57.71_11.97')).offers.map((o) => o.id)).toEqual(['se-1']);
    expect((await catalog.search({ week: '2026-W46' }, 'dk')).offers.map((o) => o.id)).toEqual(['1']);
  });

  it('says when a snapshot is missing and picks it up as soon as it exists', async () => {
    const missing = await catalog.search({ week: '2026-W47' }, 'se-57.71_11.97');
    expect(missing).toMatchObject({ totalMatches: 0, offers: [], message: expect.stringContaining('No offers have been fetched') });

    snapshots['snapshots/se-57.71_11.97/2026-W47/offers.json'] = swedish;
    try {
      const found = await catalog.search({ week: '2026-W47' }, 'se-57.71_11.97');
      expect(found.offers.map((o) => o.id)).toEqual(['se-1']);
      expect(found).not.toHaveProperty('message');
    } finally {
      delete snapshots['snapshots/se-57.71_11.97/2026-W47/offers.json'];
    }
  });

  it('filters by category, chain and validity date', async () => {
    expect((await catalog.search({ week: 'next', categories: ['fish', 'meat'] }, 'dk')).offers.map((o) => o.id)).toEqual(['2', '4']);
    expect((await catalog.search({ week: 'next', chains: ['lidl'] }, 'dk')).offers.map((o) => o.id)).toEqual(['2']);
    expect((await catalog.search({ week: 'next', validOn: '2026-11-05' }, 'dk')).offers.map((o) => o.id)).toEqual(['1', '2']);
  });
});
