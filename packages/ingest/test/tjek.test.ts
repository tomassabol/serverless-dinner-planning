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
