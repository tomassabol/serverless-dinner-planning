import { GetObjectCommand, NoSuchKey, type S3Client } from '@aws-sdk/client-s3';
import { TZDate } from '@date-fns/tz';
import Fuse from 'fuse.js';
import { TIME_ZONE, isEverydayPrice, resolveWeekKey, snapshotKey, type Offer } from '@dinner/shared';
import type { z } from 'zod';
import type { SearchOffersInput } from './definitions.js';

const CACHE_TTL_MS = 5 * 60_000;

export interface OfferSummary {
  id: string;
  chain: string;
  heading: string;
  ingredient: string | null;
  category: string | null;
  price: number;
  prePrice: number | null;
  unitPrice: Offer['unitPrice'];
  amount: Offer['amount'];
  validFrom: string;
  validTo: string;
  everydayPrice: boolean;
}

interface WeekOffers {
  loadedAt: number;
  offers: Offer[];
  fuse: Fuse<Offer>;
}

/** Shown to the agent when a market has no snapshot yet, so it can tell "not fetched" apart from "no matches". */
export const NO_SNAPSHOT_MESSAGE =
  "No offers have been fetched for this household's stores and week yet. Offers for a new location take a minute or two after it is saved; try again shortly. Do not plan around made-up offers.";

export class OfferCatalog {
  private readonly cache = new Map<string, WeekOffers>();

  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  resolveWeek(week: string | undefined): string {
    return resolveWeekKey(week, this.now());
  }

  /** Searches one offer market (see `marketFor`): "dk", or a Swedish household's location. */
  async search(input: z.infer<typeof SearchOffersInput>, marketKey: string) {
    const week = this.resolveWeek(input.week);
    const loaded = await this.load(marketKey, week);
    if (!loaded) return { week, totalMatches: 0, offers: [], message: NO_SNAPSHOT_MESSAGE };
    const { offers, fuse } = loaded;
    const dinnerOnly = input.dinnerRelevantOnly ?? true;
    const limit = input.limit ?? 20;

    const candidates = input.query ? match(input.query, offers, fuse) : offers;
    const day = input.validOn ? dayRange(input.validOn) : null;

    const matches = candidates.filter(
      (o) =>
        (!dinnerOnly || o.tags?.dinnerRelevant !== false) &&
        (!input.categories || (o.tags && input.categories.includes(o.tags.category))) &&
        (!input.chains || input.chains.includes(o.chain)) &&
        (!day || (new Date(o.validFrom) <= day.end && new Date(o.validTo) >= day.start)),
    );

    return {
      week,
      totalMatches: matches.length,
      offers: matches.slice(0, limit).map(summarize),
    };
  }

  /** The market's week snapshot, or null when ingest has not written one yet (never cached, so it shows up as soon as it exists). */
  private async load(marketKey: string, week: string): Promise<WeekOffers | null> {
    const cacheKey = `${marketKey}/${week}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

    // Danish snapshots were stored without a market prefix before Sweden was supported.
    const keys = [snapshotKey(marketKey, week), ...(marketKey === 'dk' ? [`snapshots/${week}/offers.json`] : [])];
    let offers: Offer[] | null = null;
    for (const key of keys) {
      try {
        const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
        offers = (JSON.parse(await response.Body!.transformToString()) as { offers: Offer[] }).offers;
        break;
      } catch (error) {
        if (!(error instanceof NoSuchKey)) throw error;
      }
    }
    if (!offers) return null;

    const entry: WeekOffers = {
      loadedAt: Date.now(),
      offers,
      fuse: new Fuse(offers, {
        keys: [
          { name: 'tags.canonicalIngredient', weight: 0.5 },
          { name: 'heading', weight: 0.4 },
          { name: 'description', weight: 0.1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    };
    this.cache.set(cacheKey, entry);
    return entry;
  }
}

/**
 * Plain word matching first (every query word in the ingredient tag or heading), ingredient hits
 * before heading-only hits. Fuzzy search is only a fallback for typos and odd spellings.
 */
function match(query: string, offers: Offer[], fuse: Fuse<Offer>): Offer[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const containsAll = (text: string | undefined | null) => !!text && words.every((w) => text.toLowerCase().includes(w));

  const byIngredient = offers.filter((o) => containsAll(o.tags?.canonicalIngredient));
  const byHeading = offers.filter((o) => !byIngredient.includes(o) && containsAll(o.heading));
  const exact = [...byIngredient, ...byHeading];
  return exact.length > 0 ? exact : fuse.search(query).map((r) => r.item);
}

export function summarize(offer: Offer): OfferSummary {
  return {
    id: offer.id,
    chain: offer.chain,
    heading: offer.heading,
    ingredient: offer.tags?.canonicalIngredient || null,
    category: offer.tags?.category ?? null,
    price: offer.price,
    prePrice: offer.prePrice,
    unitPrice: offer.unitPrice,
    amount: offer.amount,
    validFrom: offer.validFrom,
    validTo: offer.validTo,
    everydayPrice: isEverydayPrice(offer),
  };
}

/** Start and end of a calendar day in local (Danish and Swedish) time. */
function dayRange(date: string) {
  const start = new TZDate(`${date}T00:00:00`, TIME_ZONE);
  return { start: new Date(start.getTime()), end: new Date(start.getTime() + 24 * 3600_000 - 1) };
}
