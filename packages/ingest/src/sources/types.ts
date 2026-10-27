import type { Chain, Offer } from '@dinner/shared';

/** A provider of weekly offers. Tjek is the only one today; others can be swapped in. */
export interface OfferSource {
  readonly name: string;
  fetchRaw(chain: Chain): Promise<unknown[]>;
  normalize(chain: Chain, raw: unknown): Offer | null;
}
