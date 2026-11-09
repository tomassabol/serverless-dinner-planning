import type { Country } from './countries.js';
import type { Location, Market } from './household.js';

/**
 * An offer market: the set of offers one or more households shop from. Denmark is one national
 * market. A Swedish market is a location (rounded to about 1 km, so neighbours share it), because
 * Swedish chains price per store.
 */
export interface OfferMarket {
  key: string;
  country: Country;
  location: Location | null;
}

export const DANISH_MARKET: OfferMarket = { key: 'dk', country: 'DK', location: null };

/** The household's offer market, or null when a Swedish household has not set its location yet. */
export function marketFor(market: Market): OfferMarket | null {
  if (market.country === 'DK') return DANISH_MARKET;
  if (!market.location) return null;
  const { lat, lng } = market.location;
  return { key: `se-${lat.toFixed(2)}_${lng.toFixed(2)}`, country: 'SE', location: market.location };
}


/** S3 key of a market's week snapshot (all food offers valid in that ISO week). */
export const snapshotKey = (marketKey: string, week: string) => `snapshots/${marketKey}/${week}/offers.json`;

/** Distance in kilometres between two points (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
