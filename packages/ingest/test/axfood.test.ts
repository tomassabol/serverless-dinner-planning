import { describe, expect, it, vi } from 'vitest';
import { getChain, marketFor } from '@dinner/shared';
import fixture from './fixtures/hemkop-campaigns.json' with { type: 'json' };
import { AxfoodOfferSource, parseVolume } from '../src/sources/axfood.js';

const hemkop = getChain('hemkop');
const store = { storeId: '4150', name: 'Hemköp Stockholm Birger Jarl' };
const source = new AxfoodOfferSource();
const normalize = (name: string) => {
  const raw = fixture.find((p) => p.name === name);
  if (!raw) throw new Error(`No fixture product ${name}`);
  return source.normalize(hemkop, { ...raw, store })!;
};

describe('Axfood (Hemköp) normalization', () => {
  it('normalizes every fixture product', () => {
    expect(fixture.map((p) => source.normalize(hemkop, { ...p, store })).every(Boolean)).toBe(true);
  });

  it('keeps the store in the id and marks club prices', () => {
    const offer = normalize('Olivolja Classico');
    expect(offer.id).toBe('hemkop-4150-2500324896');
    expect(offer).toMatchObject({ source: 'axfood', chain: 'hemkop', currency: 'SEK', price: 39.95, prePrice: 68.95 });
    expect(offer.amount).toEqual({ unit: 'l', from: 0.5, to: 0.5 });
    expect(offer.unitPrice).toEqual({ value: 79.9, unit: 'l' });
    expect(offer.description).toContain('Klubbpris');
    expect(offer.validFrom).toBe('2026-11-08T23:00:00.000Z');
    expect(offer.validTo).toBe('2026-11-15T22:59:59.000Z');
  });

  it('stores multi-buy deals per piece', () => {
    const offer = normalize('Bacon');
    expect(offer.price).toBe(14);
    expect(offer.description).toContain('2 för 28 kr');
  });

  it('prices weighed goods from the per-kg deal and the approximate weight', () => {
    const offer = normalize('Svensk kycklingbröstfilé');
    expect(offer.amount).toEqual({ unit: 'kg', from: 0.85, to: 0.85 });
    expect(offer.price).toBe(84.15);
    expect(offer.unitPrice).toEqual({ value: 99, unit: 'kg' });
    expect(offer.prePrice).toBe(106.25);
  });

  it('parses Swedish volume labels', () => {
    expect(parseVolume('80-120g')).toEqual({ unit: 'kg', from: 0.08, to: 0.12 });
    expect(parseVolume('20-pack')).toEqual({ unit: 'pcs', from: 20, to: 20 });
    expect(parseVolume('1,5l')).toEqual({ unit: 'l', from: 1.5, to: 1.5 });
    expect(parseVolume(null)).toBeNull();
  });

  it('fetches the campaigns of the store nearest the market', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = url.toString();
      if (href.endsWith('/axfood/rest/store?online=false')) {
        return Response.json([
          { storeId: '1', name: 'Hemköp Malmö', geoPoint: { latitude: 55.6, longitude: 13.0 } },
          { storeId: '4150', name: store.name, geoPoint: { latitude: 59.342, longitude: 18.064 } },
        ]);
      }
      expect(href).toContain('q=4150');
      return Response.json({ results: [fixture[0]], pagination: { numberOfPages: 1 } });
    });
    const remote = new AxfoodOfferSource(fetchImpl as unknown as typeof fetch);
    const market = marketFor({ country: 'SE', location: { lat: 59.33, lng: 18.07, label: 'Stockholm' } })!;
    const raw = await remote.fetchRaw(hemkop, market);
    expect(raw).toHaveLength(1);
    expect((raw[0] as { store: unknown }).store).toEqual(store);

    const far = marketFor({ country: 'SE', location: { lat: 65.58, lng: 22.15, label: 'Luleå' } })!;
    expect(await remote.fetchRaw(hemkop, far)).toEqual([]);
  });
});
