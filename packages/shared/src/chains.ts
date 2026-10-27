import { z } from 'zod';

/**
 * Danish grocery chains with their Tjek (eTilbudsavis) dealer IDs.
 * Regional chains (Jutland only) are known but not ingested by default.
 */
export const CHAINS = [
  { id: 'netto', name: 'Netto', tjekDealerId: '9ba51' },
  { id: 'lidl', name: 'Lidl', tjekDealerId: '71c90' },
  { id: 'rema1000', name: 'REMA 1000', tjekDealerId: '11deC' },
  { id: 'foetex', name: 'føtex', tjekDealerId: 'bdf5A' },
  { id: 'bilka', name: 'Bilka', tjekDealerId: '93f13' },
  { id: 'coop365', name: '365discount', tjekDealerId: 'DWZE1w' },
  { id: 'superbrugsen', name: 'SuperBrugsen', tjekDealerId: '0b1e8' },
  { id: 'brugsen', name: 'Brugsen', tjekDealerId: 'd311fg' },
  { id: 'kvickly', name: 'Kvickly', tjekDealerId: 'c1edq' },
  { id: 'spar', name: 'SPAR', tjekDealerId: '88ddE' },
  { id: 'meny', name: 'MENY', tjekDealerId: '267e1m' },
  { id: 'lovbjerg', name: 'Løvbjerg', tjekDealerId: '65caN', regional: true },
  { id: 'abclavpris', name: 'ABC Lavpris', tjekDealerId: '70d42L', regional: true },
] as const;

export type Chain = (typeof CHAINS)[number];
export type ChainId = Chain['id'];

/** Chains ingested when no explicit list is given. */
export const DEFAULT_CHAINS: readonly Chain[] = CHAINS.filter((c) => !('regional' in c && c.regional));

export const ChainIdSchema = z.enum(CHAINS.map((c) => c.id) as [ChainId, ...ChainId[]]);

export function getChain(id: ChainId): Chain {
  const chain = CHAINS.find((c) => c.id === id);
  if (!chain) throw new Error(`Unknown chain: ${id}`);
  return chain;
}
