import { useEffect, useState } from 'react';
import type { Plan } from '../api';
import { dayMonth, dkk, shortDay } from './format';

/** Shopping list grouped by store; ticked items are remembered per week in this browser. */
export function ShoppingList({ plan }: { plan: Plan }) {
  const storageKey = `shopping:${plan.householdId}:${plan.week}`;
  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...checked]));
    } catch {
      // Private mode or blocked storage: ticks just won't persist.
    }
  }, [checked, storageKey]);

  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { stores, other, offerTotal } = plan.shoppingList;
  return (
    <section className="panel shopping" aria-labelledby="shopping-title">
      <div className="panel-header">
        <h2 id="shopping-title">Shopping list</h2>
        <span className="muted">{dkk(offerTotal)} on offers</span>
      </div>
      {stores.map((store) => (
        <div key={store.chain} className="store">
          <h3>
            {store.chainName} <span className="muted">{dkk(store.subtotal)}</span>
          </h3>
          <ul className="checklist">
            {store.items.map((item) => (
              <li key={item.offerId}>
                <label className={checked.has(item.offerId) ? 'done' : ''}>
                  <input type="checkbox" checked={checked.has(item.offerId)} onChange={() => toggle(item.offerId)} />
                  <span className="item-text">
                    {item.heading}
                    <small className="muted">
                      for {item.forDinners.map(shortDay).join(', ')} · until {dayMonth(item.validTo.slice(0, 10))}
                    </small>
                  </span>
                  <span className="price">
                    {dkk(item.price)}
                    {item.prePrice ? <s className="muted">{dkk(item.prePrice)}</s> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {other.length > 0 && (
        <div className="store">
          <h3>
            Also needed <span className="muted">check your pantry</span>
          </h3>
          <ul className="checklist">
            {other.map((item) => (
              <li key={item.name}>
                <label className={checked.has(`other:${item.name}`) ? 'done' : ''}>
                  <input type="checkbox" checked={checked.has(`other:${item.name}`)} onChange={() => toggle(`other:${item.name}`)} />
                  <span className="item-text">{item.name}</span>
                  <span className="price muted">{item.grams} g</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
