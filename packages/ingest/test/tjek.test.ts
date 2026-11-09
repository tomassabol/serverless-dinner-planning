import { describe, expect, it } from 'vitest';
import { getChain } from '@dinner/shared';
import fixture from './fixtures/tjek-offers.json' with { type: 'json' };
import { TjekOfferSource } from '../src/sources/tjek.js';

const source = new TjekOfferSource();
const foetex = getChain('foetex');
const byHeading = (prefix: string) => {
  const raw = fixture.find((o) => o.heading.startsWith(prefix));
  if (!raw) throw new Error(`No fixture offer starting with ${prefix}`);
  return source.normalize(foetex, raw)!;
};

describe('Tjek normalization', () => {
  it('normalizes every fixture offer', () => {
    expect(fixture.map((o) => source.normalize(foetex, o)).every(Boolean)).toBe(true);
  });

  it('converts gram ranges to kg and computes a midpoint unit price', () => {
    const offer = byHeading('Hakket okse');
    expect(offer.amount).toEqual({ unit: 'kg', from: 0.6, to: 1 });
    expect(offer.unitPrice).toEqual({ value: 48.75, unit: 'kg' });
  });

  it('multiplies multipacks', () => {
    const offer = byHeading('Coca Cola');
    expect(offer.amount).toEqual({ unit: 'l', from: 7.92, to: 7.92 });
  });

  it('keeps piece counts as-is', () => {
    const offer = byHeading('Dava');
    expect(offer.amount).toEqual({ unit: 'pcs', from: 8, to: 8 });
    expect(offer.unitPrice).toEqual({ value: 2.75, unit: 'pcs' });
  });

  it('turns Tjek timestamps into UTC ISO strings', () => {
    const offer = byHeading('Hamburgerryg');
    expect(offer.validFrom).toBe('2026-10-22T22:00:00.000Z');
    expect(offer.validTo).toBe('2026-10-29T22:59:59.000Z');
    expect(offer.chain).toBe('foetex');
    expect(offer.tags).toBeNull();
  });

  it('rejects malformed offers', () => {
    expect(source.normalize(foetex, { id: 'x' })).toBeNull();
  });
});

describe('Tjek fetching for Swedish markets', () => {
  const market = { key: 'se-57.71_11.97', country: 'SE' as const, location: { lat: 57.71, lng: 11.97, label: 'Göteborg' } };
  const catalog = (id: string, allStores: boolean) => ({ id, label: 'Vecka 46', offer_count: 1, run_till: '2099-01-01T22:59:59+0000', all_stores: allStores });

  it('asks for the nearest store and falls back to a nationwide flyer', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const href = url.toString();
      urls.push(href);
      if (href.includes('/catalogs?') && href.includes('r_lat=')) return Response.json([]);
      if (href.includes('/catalogs?')) return Response.json([catalog('store-specific', false), catalog('national', true)]);
      return Response.json([fixture[0]]);
    };
    const remote = new TjekOfferSource(fetchImpl as unknown as typeof fetch);
    const raw = await remote.fetchRaw(getChain('city-gross'), market);
    expect(raw).toHaveLength(1);
    expect(urls[0]).toContain('r_lat=57.71&r_lng=11.97&r_radius=15000&order_by=distance');
    expect(urls.at(-1)).toContain('catalog_ids=national');
  });

  it('refuses a Swedish chain without a location', async () => {
    await expect(source.fetchRaw(getChain('ica-nara'), { ...market, location: null })).rejects.toThrow('location');
  });
});
