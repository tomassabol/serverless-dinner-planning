import { GetObjectCommand, NoSuchKey, type S3Client } from '@aws-sdk/client-s3';
import { TZDate } from '@date-fns/tz';
import { addWeeks } from 'date-fns';
import Fuse from 'fuse.js';
import { TIME_ZONE, isoWeekRange, type Offer } from '@dinner/shared';
import type { z } from 'zod';
import type { SearchOffersInput } from './definitions.js';

const CACHE_TTL_MS = 5 * 60_000;
const EVERYDAY_PRICE = /fast lav pris|altid lav pris|hver dag/i;

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

export class OfferCatalog {
  private readonly cache = new Map<string, WeekOffers>();

  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  resolveWeek(week: string | undefined): string {
    if (!week || week === 'current') return isoWeekRange(this.now()).key;
    if (week === 'next') return isoWeekRange(addWeeks(new TZDate(this.now(), TIME_ZONE), 1)).key;
    return week;
  }

  async search(input: z.infer<typeof SearchOffersInput>) {
    const week = this.resolveWeek(input.week);
    const { offers, fuse } = await this.load(week);
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

  private async load(week: string): Promise<WeekOffers> {
    const cached = this.cache.get(week);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;

    let offers: Offer[] = [];
    try {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: `snapshots/${week}/offers.json` }),
      );
      offers = (JSON.parse(await response.Body!.transformToString()) as { offers: Offer[] }).offers;
    } catch (error) {
      if (!(error instanceof NoSuchKey)) throw error;
    }

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
    this.cache.set(week, entry);
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
    everydayPrice: EVERYDAY_PRICE.test(offer.description ?? ''),
  };
}

/** Start and end of a calendar day in Danish time. */
function dayRange(date: string) {
  const start = new TZDate(`${date}T00:00:00`, TIME_ZONE);
  return { start: new Date(start.getTime()), end: new Date(start.getTime() + 24 * 3600_000 - 1) };
}
