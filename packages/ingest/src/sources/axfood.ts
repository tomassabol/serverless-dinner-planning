import { TZDate } from '@date-fns/tz';
import { z } from 'zod';
import { TIME_ZONE, distanceKm, type Chain, type Offer, type OfferMarket, type Unit } from '@dinner/shared';
import { NEARBY_RADIUS_KM, type OfferSource } from './types.js';

/**
 * Hemköp (Axfood) is not on Tjek. Its website serves each store's weekly campaigns as JSON:
 *   GET /axfood/rest/store?online=false                              every store with coordinates
 *   GET /search/campaigns/offline?q=<storeId>&type=PERSONAL_GENERAL  that store's in-store campaigns
 * Like Tjek, this is a public endpoint without a contract: keep the volume tiny (one store per market, daily).
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const USER_AGENT = 'dinner-planner/0.1 (personal, non-commercial)';

const StoreSchema = z.object({
  storeId: z.string(),
  name: z.string(),
  geoPoint: z.object({ latitude: z.number(), longitude: z.number() }).nullable().optional(),
});
type Store = z.infer<typeof StoreSchema>;

const PromotionSchema = z.object({
  code: z.string(),
  price: z.number().nullable(),
  qualifyingCount: z.number().nullable().optional(),
  rewardLabel: z.string().nullable().optional(),
  comparePrice: z.string().nullable().optional(),
  startDate: z.string(),
  validUntil: z.number(),
  description: z.string().nullable().optional(),
  textLabel: z.string().nullable().optional(),
  campaignType: z.string().nullable().optional(),
});

const AxfoodProductSchema = z.object({
  name: z.string(),
  manufacturer: z.string().nullable().optional(),
  displayVolume: z.string().nullable().optional(),
  /** Ordinary price, e.g. "68,95 kr"; per kg when `priceUnit` is "kr/kg". */
  price: z.string().nullable().optional(),
  priceUnit: z.string().nullable().optional(),
  image: z.object({ url: z.string() }).nullable().optional(),
  potentialPromotions: z.array(PromotionSchema).min(1),
  /** Set by fetchRaw so ids and descriptions can name the store. */
  store: z.object({ storeId: z.string(), name: z.string() }),
});
export type AxfoodProduct = z.infer<typeof AxfoodProductSchema>;

const CampaignPageSchema = z.object({
  results: z.array(z.unknown()),
  pagination: z.object({ numberOfPages: z.number() }),
});

/** "68,95 kr" or "99 kr/kg" -> 68.95 / 99. */
const parseKr = (value: string | null | undefined): number | null => {
  const match = /(\d[\d\s]*(?:,\d+)?)/.exec(value ?? '');
  return match ? Number(match[1]!.replace(/\s/g, '').replace(',', '.')) : null;
};

const UNITS: Record<string, { unit: Unit; factor: number }> = {
  g: { unit: 'kg', factor: 0.001 },
  kg: { unit: 'kg', factor: 1 },
  ml: { unit: 'l', factor: 0.001 },
  cl: { unit: 'l', factor: 0.01 },
  dl: { unit: 'l', factor: 0.1 },
  l: { unit: 'l', factor: 1 },
  st: { unit: 'pcs', factor: 1 },
  '-pack': { unit: 'pcs', factor: 1 },
};

/** "ca 850g", "80-120g", "500ml", "20-pack" -> an amount range in kg / l / pcs. */
export function parseVolume(volume: string | null | undefined): Offer['amount'] {
  const match = /(\d+(?:,\d+)?)(?:\s*-\s*(\d+(?:,\d+)?))?\s*(kg|g|ml|cl|dl|l|st|-pack)\b/i.exec(volume ?? '');
  if (!match) return null;
  const unit = UNITS[match[3]!.toLowerCase()]!;
  const from = Number(match[1]!.replace(',', '.')) * unit.factor;
  const to = match[2] ? Number(match[2].replace(',', '.')) * unit.factor : from;
  return { unit: unit.unit, from: round(from, 3), to: round(to, 3) };
}

export function normalizeAxfoodProduct(chain: Chain, product: AxfoodProduct): Offer | null {
  const promo = product.potentialPromotions[0]!;
  const amount = parseVolume(product.displayVolume);
  const midpoint = amount ? (amount.from + amount.to) / 2 : 0;
  const perKgOrdinary = product.priceUnit?.includes('/kg') ?? false;
  const ordinary = parseKr(product.price);

  let price: number;
  let prePrice: number | null;
  const notes: string[] = [];
  if (promo.price != null) {
    // Multi-buy deals ("2 för 28 kr") are stored per piece, with the deal in the description.
    const count = promo.qualifyingCount && promo.qualifyingCount > 1 ? promo.qualifyingCount : 1;
    price = round(promo.price / count, 2);
    prePrice = ordinary != null && !perKgOrdinary ? ordinary : null;
    if (count > 1) notes.push(`${count} för ${promo.price} kr`);
  } else {
    // Weighed goods: the deal is a price per kg ("99 kr/kg").
    const perKg = parseKr(promo.rewardLabel) ?? parseKr(promo.comparePrice);
    if (perKg == null) return null;
    const kg = amount?.unit === 'kg' && midpoint > 0 ? midpoint : null;
    price = kg ? round(perKg * kg, 2) : perKg;
    prePrice = ordinary != null && perKgOrdinary ? round(kg ? ordinary * kg : ordinary, 2) : null;
    notes.push(`${perKg} kr/kg`);
  }
  if (prePrice != null && prePrice <= price) prePrice = null;
  if (promo.campaignType === 'LOYALTY') notes.push(`${promo.textLabel || 'Klubbpris'} (Hemköp Klubb, gratis medlemskap)`);

  const unitPrice =
    amount && midpoint > 0 ? { value: round(price / midpoint, 2), unit: amount.unit } : promo.price == null ? { value: price, unit: 'kg' as const } : null;

  const description = [product.manufacturer, product.displayVolume, promo.description, ...notes, product.store.name]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join('. ');

  return {
    id: `${chain.id}-${product.store.storeId}-${promo.code}`,
    source: 'axfood',
    chain: chain.id,
    heading: product.name.trim(),
    description: description || null,
    price,
    prePrice,
    currency: 'SEK',
    amount,
    unitPrice,
    validFrom: startOfDay(promo.startDate),
    validTo: new Date(promo.validUntil).toISOString(),
    publishedAt: null,
    imageUrl: product.image?.url ?? null,
    catalogId: `${chain.id}-${product.store.storeId}`,
    tags: null,
  };
}

/** "09/11-2026" (day/month-year, local time) -> UTC ISO of local midnight. */
function startOfDay(value: string): string {
  const match = /^(\d{2})\/(\d{2})-(\d{4})$/.exec(value);
  if (!match) throw new Error(`Unexpected Axfood date: ${value}`);
  return new Date(new TZDate(`${match[3]}-${match[2]}-${match[1]}T00:00:00`, TIME_ZONE).getTime()).toISOString();
}

export class AxfoodOfferSource implements OfferSource {
  readonly name = 'axfood';
  private stores = new Map<string, Promise<Store[]>>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchRaw(chain: Chain, market: OfferMarket): Promise<unknown[]> {
    if (chain.source !== 'axfood') throw new Error(`${chain.id} is not an Axfood chain`);
    if (!market.location) throw new Error(`${chain.id} needs a market location`);

    const store = await this.nearestStore(chain.axfoodSite, market.location);
    if (!store) return [];

    const all: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = CampaignPageSchema.parse(
        await this.getJson(
          `${chain.axfoodSite}/search/campaigns/offline?q=${encodeURIComponent(store.storeId)}&type=PERSONAL_GENERAL&page=${page}&size=${PAGE_SIZE}`,
        ),
      );
      all.push(...response.results.map((r) => ({ ...(r as object), store: { storeId: store.storeId, name: store.name } })));
      if (page + 1 >= response.pagination.numberOfPages) break;
    }
    return all;
  }

  normalize(chain: Chain, raw: unknown): Offer | null {
    const parsed = AxfoodProductSchema.safeParse(raw);
    if (!parsed.success) return null;
    try {
      return normalizeAxfoodProduct(chain, parsed.data);
    } catch {
      return null;
    }
  }

  private async nearestStore(site: string, location: { lat: number; lng: number }): Promise<Store | null> {
    let stores = this.stores.get(site);
    if (!stores) {
      stores = this.getJson(`${site}/axfood/rest/store?online=false`).then((body) =>
        z.array(z.unknown()).parse(body).flatMap((s) => {
          const parsed = StoreSchema.safeParse(s);
          return parsed.success ? [parsed.data] : [];
        }),
      );
      this.stores.set(site, stores);
    }
    const nearby = (await stores)
      .filter((s) => s.geoPoint)
      .map((s) => ({ store: s, km: distanceKm(location, { lat: s.geoPoint!.latitude, lng: s.geoPoint!.longitude }) }))
      .filter((s) => s.km <= NEARBY_RADIUS_KM)
      .sort((a, b) => a.km - b.km);
    return nearby[0]?.store ?? null;
  }

  private async getJson(url: string, attempt = 1): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      return this.getJson(url, attempt + 1);
    }
    throw new Error(`Axfood request failed with ${response.status}: ${url}`);
  }
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;
