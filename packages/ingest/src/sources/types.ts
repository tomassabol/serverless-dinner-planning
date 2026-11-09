import type { Chain, Offer, OfferMarket } from '@dinner/shared';

/** A provider of weekly offers (Tjek for most chains, Axfood's web API for Hemköp). */
export interface OfferSource {
  readonly name: string;
  /** Raw offers of one chain for a market. Local chains use the store nearest the market's location. */
  fetchRaw(chain: Chain, market: OfferMarket): Promise<unknown[]>;
  normalize(chain: Chain, raw: unknown): Offer | null;
}

/** Stores further away than this are not considered "nearby" for a household. */
export const NEARBY_RADIUS_KM = 15;
