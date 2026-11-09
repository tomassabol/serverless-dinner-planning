import { z } from 'zod';
import type { Country } from './countries.js';

/**
 * Grocery chains and where their offers come from.
 *
 * - Danish chains publish one national Tjek (eTilbudsavis) flyer, so they are fetched once for everyone.
 *   Regional chains (Jutland only) are known but not ingested by default.
 * - Swedish chains on Tjek (eReklamblad) publish a flyer per store, so they are fetched per household
 *   location: the nearest store's catalog for each chain (`local: true`).
 * - Hemköp is not on Tjek; its per-store campaigns come from Axfood's public web API, for the store
 *   nearest the household.
 */
export const CHAINS = [
  { id: 'netto', name: 'Netto', country: 'DK', source: 'tjek', tjekDealerId: '9ba51' },
  { id: 'lidl', name: 'Lidl', country: 'DK', source: 'tjek', tjekDealerId: '71c90' },
  { id: 'rema1000', name: 'REMA 1000', country: 'DK', source: 'tjek', tjekDealerId: '11deC' },
  { id: 'foetex', name: 'føtex', country: 'DK', source: 'tjek', tjekDealerId: 'bdf5A' },
  { id: 'bilka', name: 'Bilka', country: 'DK', source: 'tjek', tjekDealerId: '93f13' },
  { id: 'coop365', name: '365discount', country: 'DK', source: 'tjek', tjekDealerId: 'DWZE1w' },
  { id: 'superbrugsen', name: 'SuperBrugsen', country: 'DK', source: 'tjek', tjekDealerId: '0b1e8' },
  { id: 'brugsen', name: 'Brugsen', country: 'DK', source: 'tjek', tjekDealerId: 'd311fg' },
  { id: 'kvickly', name: 'Kvickly', country: 'DK', source: 'tjek', tjekDealerId: 'c1edq' },
  { id: 'spar', name: 'SPAR', country: 'DK', source: 'tjek', tjekDealerId: '88ddE' },
  { id: 'meny', name: 'MENY', country: 'DK', source: 'tjek', tjekDealerId: '267e1m' },
  { id: 'lovbjerg', name: 'Løvbjerg', country: 'DK', source: 'tjek', tjekDealerId: '65caN', regional: true },
  { id: 'abclavpris', name: 'ABC Lavpris', country: 'DK', source: 'tjek', tjekDealerId: '70d42L', regional: true },

  { id: 'ica-maxi', name: 'Maxi ICA Stormarknad', country: 'SE', source: 'tjek', tjekDealerId: 'ca802A', local: true },
  { id: 'ica-kvantum', name: 'ICA Kvantum', country: 'SE', source: 'tjek', tjekDealerId: '9cb4wA', local: true },
  { id: 'ica-supermarket', name: 'ICA Supermarket', country: 'SE', source: 'tjek', tjekDealerId: '1d1dvA', local: true },
  { id: 'ica-nara', name: 'ICA Nära', country: 'SE', source: 'tjek', tjekDealerId: '20d4lA', local: true },
  { id: 'hemkop', name: 'Hemköp', country: 'SE', source: 'axfood', axfoodSite: 'https://www.hemkop.se', local: true },
  { id: 'willys', name: 'Willys', country: 'SE', source: 'tjek', tjekDealerId: 'c371GA', local: true },
  { id: 'lidl-se', name: 'Lidl', country: 'SE', source: 'tjek', tjekDealerId: '03a7b3', local: true },
  { id: 'coop-se', name: 'Coop', country: 'SE', source: 'tjek', tjekDealerId: '63eeoD', local: true },
  { id: 'stora-coop', name: 'Stora Coop', country: 'SE', source: 'tjek', tjekDealerId: '6c28SD', local: true },
  { id: 'city-gross', name: 'City Gross', country: 'SE', source: 'tjek', tjekDealerId: 'bfe5hA', local: true },
] as const;

export type Chain = (typeof CHAINS)[number];
export type ChainId = Chain['id'];
export type TjekChain = Extract<Chain, { source: 'tjek' }>;
export type AxfoodChain = Extract<Chain, { source: 'axfood' }>;

const isRegional = (c: Chain) => 'regional' in c && c.regional;

/** Chains ingested when no explicit list is given. */
export const DEFAULT_CHAINS: readonly Chain[] = CHAINS.filter((c) => !isRegional(c));

export const ChainIdSchema = z.enum(CHAINS.map((c) => c.id) as [ChainId, ...ChainId[]]);

export function getChain(id: ChainId): Chain {
  const chain = CHAINS.find((c) => c.id === id);
  if (!chain) throw new Error(`Unknown chain: ${id}`);
  return chain;
}

/** Chains ingested by default for a country. */
export const chainsFor = (country: Country): readonly Chain[] => DEFAULT_CHAINS.filter((c) => c.country === country);

export const chainName = (id: string) => CHAINS.find((c) => c.id === id)?.name ?? id;
