import { useState } from 'react';
import type { PlanDinner, Rating } from '../api';
import { longDay } from './format';

interface Props {
  dinner: PlanDinner;
  storeByOffer: Map<string, string>;
  isToday: boolean;
  onRate: (date: string, rating: Rating) => Promise<void>;
}

export function DinnerCard({ dinner, storeByOffer, isToday, onRate }: Props) {
  const [rating, setRating] = useState<Rating | null>(dinner.rating);
  const [saving, setSaving] = useState(false);

  const rate = async (value: Rating) => {
    const previous = rating;
    setRating(value);
    setSaving(true);
    try {
      await onRate(dinner.date, value);
    } catch {
      setRating(previous);
    } finally {
      setSaving(false);
    }
  };

  const stores = [...new Set(dinner.ingredients.map((i) => (i.offerId ? storeByOffer.get(i.offerId) : undefined)).filter(Boolean))];

  return (
    <article className={`dinner${isToday ? ' dinner-today' : ''}`}>
      {dinner.imageUrl ? (
        <img className="dinner-image" src={dinner.imageUrl} alt={dinner.dish} loading="lazy" />
      ) : (
        <div className="dinner-image dinner-image-placeholder" aria-hidden>
          🍽️
        </div>
      )}
      <div className="dinner-body">
        <div className="dinner-day">
          {longDay(dinner.date)}
          {isToday && <span className="pill pill-accent">Tonight</span>}
        </div>
        <h3>{dinner.dish}</h3>
        <p className="dinner-description">{dinner.description}</p>
        <ul className="facts" aria-label="Key facts">
          <li>⏱ {dinner.cookingMinutes} min</li>
          <li>🔥 {dinner.nutrition.kcal} kcal</li>
          <li>💪 {dinner.nutrition.protein} g protein</li>
          <li>🌾 {dinner.nutrition.fiber} g fibre</li>
        </ul>
        {stores.length > 0 && (
          <div className="stores">
            {stores.map((s) => (
              <span key={s} className="pill">{s} offer</span>
            ))}
          </div>
        )}

        <details className="recipe">
          <summary>Recipe for {dinner.servings}</summary>
          <h4>Ingredients</h4>
          <ul className="ingredients">
            {dinner.ingredients.map((i) => (
              <li key={`${i.name}-${i.grams}`}>
                <span>{i.name}</span>
                <span className="muted">
                  {i.grams} g{i.offerId && storeByOffer.get(i.offerId) ? ` · ${storeByOffer.get(i.offerId)}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <h4>Steps</h4>
          <ol className="steps">
            {dinner.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="muted small">
            Per serving: {dinner.nutrition.kcal} kcal · {dinner.nutrition.protein} g protein · {dinner.nutrition.fat} g fat ·{' '}
            {dinner.nutrition.carbs} g carbs · {dinner.nutrition.salt} g salt
          </p>
        </details>

        <div className="rating" role="group" aria-label="Did you like it?">
          <span className="muted small">Did you like it?</span>
          <button className={`icon-button${rating === 'up' ? ' selected' : ''}`} aria-pressed={rating === 'up'} disabled={saving} onClick={() => rate('up')} title="Liked it">
            👍
          </button>
          <button className={`icon-button${rating === 'down' ? ' selected' : ''}`} aria-pressed={rating === 'down'} disabled={saving} onClick={() => rate('down')} title="Not again">
            👎
          </button>
        </div>
      </div>
    </article>
  );
}
