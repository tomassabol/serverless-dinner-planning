import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPlan, rateMeal, type Plan, type Rating } from '../api';
import { DinnerCard } from './DinnerCard';
import { ShoppingList } from './ShoppingList';
import { dkk, todayInCopenhagen, weekNumber, weekRange } from './format';

type Week = 'current' | 'next';

export function PlanView({ refreshKey }: { refreshKey: number }) {
  const [week, setWeek] = useState<Week | null>(null);
  const [plans, setPlans] = useState<Partial<Record<Week, Plan | null>>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [current, next] = await Promise.all([getPlan('current'), getPlan('next')]);
      setPlans({ current, next });
      // Show the week being shopped for: next week once it has a plan, otherwise this week.
      setWeek((w) => w ?? (next ? 'next' : 'current'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the plan');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const plan = week ? plans[week] : undefined;
  const storeByOffer = useMemo(
    () => new Map(plan?.shoppingList.stores.flatMap((s) => s.items.map((i) => [i.offerId, s.chainName] as const)) ?? []),
    [plan],
  );
  const today = todayInCopenhagen();

  const onRate = async (date: string, rating: Rating) => {
    await rateMeal(date, rating);
  };

  return (
    <div className="plan-view">
      <div className="week-switch" role="tablist" aria-label="Week">
        {(['current', 'next'] as const).map((w) => (
          <button key={w} role="tab" aria-selected={week === w} className={week === w ? 'active' : ''} onClick={() => setWeek(w)}>
            {w === 'current' ? 'This week' : 'Next week'}
          </button>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error} <button className="link" onClick={() => void load()}>Try again</button>
        </p>
      )}
      {!error && plan === undefined && <div className="skeleton" aria-busy="true">Loading the plan…</div>}
      {plan === null && (
        <section className="panel empty">
          <h2>No plan yet</h2>
          <p className="muted">
            {week === 'next'
              ? 'Next week is planned every Sunday at 17:00. You can also ask the chat to make one now.'
              : 'There is no plan for this week. Ask the chat to make one.'}
          </p>
        </section>
      )}

      {plan && (
        <>
          <header className="plan-header">
            <p className="eyebrow">
              Week {weekNumber(plan.week)} · {weekRange(plan.dinners[0]?.date ?? today)}
            </p>
            <h1>What's for dinner</h1>
            <p className="summary">{plan.verdict.summary}</p>
            <div className="chips">
              <span className="pill">Reviewed {plan.verdict.score}/10</span>
              <span className="pill">{plan.dinners.length} dinners</span>
              <span className="pill">{dkk(plan.shoppingList.offerTotal)} on offers</span>
              {plan.state === 'generating_images' && <span className="pill">Photos on their way…</span>}
            </div>
          </header>

          <div className="plan-layout">
            <div className="dinners">
              {plan.dinners.map((dinner) => (
                <DinnerCard key={`${dinner.date}-${dinner.dish}`} dinner={dinner} storeByOffer={storeByOffer} isToday={dinner.date === today} onRate={onRate} />
              ))}
            </div>
            <aside>
              <ShoppingList plan={plan} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
