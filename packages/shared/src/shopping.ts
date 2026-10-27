import { CHAINS } from './chains.js';
import type { Offer } from './offer.js';
import type { Dinner, ShoppingList } from './plan.js';

/** Groups offer ingredients by store and sums everything else, so the household can shop per chain. */
export function buildShoppingList(dinners: Dinner[], offers: Map<string, Offer>): ShoppingList {
  const stores = new Map<string, ShoppingList['stores'][number]>();
  const other = new Map<string, ShoppingList['other'][number]>();

  for (const dinner of dinners) {
    for (const ingredient of dinner.ingredients) {
      const offer = ingredient.offerId ? offers.get(ingredient.offerId) : undefined;
      if (!offer) {
        const key = ingredient.name.trim().toLowerCase();
        const entry = other.get(key) ?? { name: ingredient.name.trim(), grams: 0, forDinners: [] };
        entry.grams += ingredient.grams;
        addDate(entry.forDinners, dinner.date);
        other.set(key, entry);
        continue;
      }

      const store = stores.get(offer.chain) ?? {
        chain: offer.chain,
        chainName: CHAINS.find((c) => c.id === offer.chain)?.name ?? offer.chain,
        items: [],
        subtotal: 0,
      };
      const existing = store.items.find((i) => i.offerId === offer.id);
      if (existing) {
        addDate(existing.forDinners, dinner.date);
      } else {
        store.items.push({
          offerId: offer.id,
          heading: offer.heading,
          ingredient: ingredient.name,
          price: offer.price,
          prePrice: offer.prePrice,
          validTo: offer.validTo,
          forDinners: [dinner.date],
        });
        store.subtotal = round(store.subtotal + offer.price);
      }
      stores.set(offer.chain, store);
    }
  }

  const storeList = [...stores.values()].sort((a, b) => b.subtotal - a.subtotal);
  return {
    stores: storeList,
    other: [...other.values()].map((o) => ({ ...o, grams: Math.round(o.grams) })).sort((a, b) => a.name.localeCompare(b.name)),
    offerTotal: round(storeList.reduce((sum, s) => sum + s.subtotal, 0)),
  };
}

function addDate(dates: string[], date: string) {
  if (!dates.includes(date)) dates.push(date);
}

const round = (n: number) => Math.round(n * 100) / 100;
