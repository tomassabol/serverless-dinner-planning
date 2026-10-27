import { z } from 'zod';
import type { Chain, Offer, Unit } from '@dinner/shared';
import type { OfferSource } from './types.js';

const BASE_URL = 'https://squid-api.tjek.com/v2';
const PAGE_SIZE = 100;
/** Tjek rejects offset + limit beyond 1000, so offers are fetched per catalog. */
const MAX_OFFSET = 1000;
const PAGE_DELAY_MS = 250;
const USER_AGENT = 'dinner-planner/0.1 (personal, non-commercial)';

/** Catalogs that never contain groceries (Bilka/føtex run separate non-food flyers). */
const NON_FOOD_CATALOG = /non-?food|legetøj|elektronik|prosonic|bolig|have|tekstil|tøj|halloween|jul(e)?gaver/i;

const TjekCatalogSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  offer_count: z.number().nullable(),
  run_till: z.string(),
});

const range = z.object({ from: z.number().nullable(), to: z.number().nullable() });

const TjekOfferSchema = z.object({
  id: z.string(),
  heading: z.string(),
  description: z.string().nullable(),
  pricing: z.object({
    price: z.number(),
    pre_price: z.number().nullable(),
    currency: z.string(),
  }),
  quantity: z
    .object({
      unit: z
        .object({
          symbol: z.string(),
          si: z.object({ symbol: z.string(), factor: z.number() }),
        })
        .nullable(),
      size: range.nullable(),
      pieces: range.nullable(),
    })
    .nullable(),
  images: z.object({ view: z.string().nullable().optional() }).nullable(),
  run_from: z.string(),
  run_till: z.string(),
  publish: z.string().nullable(),
  catalog_id: z.string().nullable(),
});
export type TjekOffer = z.infer<typeof TjekOfferSchema>;

const SI_UNITS: Record<string, Unit> = { kg: 'kg', l: 'l', pcs: 'pcs' };

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** Tjek returns `+0000` offsets; turn them into canonical UTC ISO strings. */
const toIso = (value: string) => new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString();

export function normalizeTjekOffer(chain: Chain, offer: TjekOffer): Offer {
  const amount = toAmount(offer.quantity);
  const midpoint = amount ? (amount.from + amount.to) / 2 : 0;

  return {
    id: offer.id,
    source: 'tjek',
    chain: chain.id,
    heading: offer.heading.trim(),
    description: offer.description?.trim() || null,
    price: offer.pricing.price,
    prePrice: offer.pricing.pre_price,
    currency: offer.pricing.currency,
    amount,
    unitPrice: amount && midpoint > 0 ? { value: round(offer.pricing.price / midpoint, 2), unit: amount.unit } : null,
    validFrom: toIso(offer.run_from),
    validTo: toIso(offer.run_till),
    publishedAt: offer.publish ? toIso(offer.publish) : null,
    imageUrl: offer.images?.view ?? null,
    catalogId: offer.catalog_id,
    tags: null,
  };
}

function toAmount(quantity: TjekOffer['quantity']): Offer['amount'] {
  const unit = quantity?.unit ? SI_UNITS[quantity.unit.si.symbol] : undefined;
  if (!quantity?.unit || !unit) return null;

  const factor = quantity.unit.si.factor;
  const from = quantity.size?.from ?? quantity.size?.to;
  const to = quantity.size?.to ?? quantity.size?.from;
  if (from == null || to == null) return null;

  // A multipack (e.g. 24 x 33 cl) multiplies the size; for `pcs` the size already is the piece count.
  const pieces = unit === 'pcs' ? 1 : (quantity.pieces?.from ?? 1);
  return { unit, from: round(from * factor * pieces, 3), to: round(to * factor * pieces, 3) };
}

export class TjekOfferSource implements OfferSource {
  readonly name = 'tjek';

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchRaw(chain: Chain): Promise<unknown[]> {
    const catalogs = z
      .array(TjekCatalogSchema)
      .parse(await this.getJson(`${BASE_URL}/catalogs?dealer_ids=${chain.tjekDealerId}&limit=${PAGE_SIZE}`));

    const now = Date.now();
    const relevant = catalogs.filter(
      (c) => !NON_FOOD_CATALOG.test(c.label ?? '') && new Date(toIso(c.run_till)).getTime() > now,
    );

    // Some dealers (e.g. Løvbjerg) expose offers without listing catalogs.
    if (catalogs.length === 0) {
      return this.fetchPaged(`${BASE_URL}/offers?dealer_ids=${chain.tjekDealerId}`);
    }

    const all: unknown[] = [];
    for (const catalog of relevant) {
      all.push(...(await this.fetchPaged(`${BASE_URL}/offers?catalog_ids=${catalog.id}`)));
    }
    return all;
  }

  private async fetchPaged(baseUrl: string): Promise<unknown[]> {
    const all: unknown[] = [];
    for (let offset = 0; offset + PAGE_SIZE <= MAX_OFFSET; offset += PAGE_SIZE) {
      const batch = await this.getJson(`${baseUrl}&limit=${PAGE_SIZE}&offset=${offset}`);
      if (!Array.isArray(batch)) throw new Error(`Unexpected Tjek response for ${baseUrl}: not an array`);
      all.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      await sleep(PAGE_DELAY_MS);
    }
    return all;
  }

  normalize(chain: Chain, raw: unknown): Offer | null {
    const parsed = TjekOfferSchema.safeParse(raw);
    return parsed.success ? normalizeTjekOffer(chain, parsed.data) : null;
  }

  private async getJson(url: string, attempt = 1): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      return this.getJson(url, attempt + 1);
    }
    throw new Error(`Tjek request failed with ${response.status}: ${url}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
