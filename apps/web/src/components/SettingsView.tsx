import { useEffect, useState } from 'react';
import { getHousehold, saveHousehold, type Household } from '../api';
import type { Country, Location } from '@dinner/shared';

/** City centres for a quick pick; "Use my location" covers everywhere else. */
const SWEDISH_PLACES: Location[] = [
  { label: 'Stockholm', lat: 59.3293, lng: 18.0686 },
  { label: 'Göteborg', lat: 57.7089, lng: 11.9746 },
  { label: 'Malmö', lat: 55.605, lng: 13.0038 },
  { label: 'Uppsala', lat: 59.8586, lng: 17.6389 },
  { label: 'Västerås', lat: 59.6099, lng: 16.5448 },
  { label: 'Örebro', lat: 59.2753, lng: 15.2134 },
  { label: 'Linköping', lat: 58.4108, lng: 15.6214 },
  { label: 'Helsingborg', lat: 56.0465, lng: 12.6945 },
  { label: 'Jönköping', lat: 57.7826, lng: 14.1618 },
  { label: 'Norrköping', lat: 58.5877, lng: 16.1924 },
  { label: 'Lund', lat: 55.7047, lng: 13.191 },
  { label: 'Umeå', lat: 63.8258, lng: 20.263 },
  { label: 'Gävle', lat: 60.6749, lng: 17.1413 },
  { label: 'Borås', lat: 57.721, lng: 12.9401 },
  { label: 'Södertälje', lat: 59.1955, lng: 17.6253 },
  { label: 'Eskilstuna', lat: 59.3666, lng: 16.5077 },
  { label: 'Halmstad', lat: 56.6745, lng: 12.8578 },
  { label: 'Växjö', lat: 56.8777, lng: 14.8091 },
  { label: 'Karlstad', lat: 59.4022, lng: 13.5115 },
  { label: 'Sundsvall', lat: 62.3908, lng: 17.3069 },
  { label: 'Kalmar', lat: 56.6634, lng: 16.3568 },
  { label: 'Kristianstad', lat: 56.0294, lng: 14.1567 },
  { label: 'Trollhättan', lat: 58.2837, lng: 12.2886 },
  { label: 'Falun', lat: 60.6065, lng: 15.6355 },
  { label: 'Skövde', lat: 58.391, lng: 13.8451 },
  { label: 'Varberg', lat: 57.1056, lng: 12.2508 },
  { label: 'Östersund', lat: 63.1792, lng: 14.6357 },
  { label: 'Luleå', lat: 65.5848, lng: 22.1567 },
];

const COUNTRY_LABELS: Record<Country, string> = { DK: 'Denmark', SE: 'Sweden' };

const sameLocation = (a: Location | null, b: Location | null) => a?.lat === b?.lat && a?.lng === b?.lng;

export function SettingsView({ onSaved }: { onSaved: (household: Household) => void }) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [country, setCountry] = useState<Country>('DK');
  const [location, setLocation] = useState<Location | null>(null);
  const [chains, setChains] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (h: Household) => {
    setHousehold(h);
    setCountry(h.country);
    setLocation(h.location);
    setChains(new Set(h.preferredChains));
  };

  useEffect(() => {
    getHousehold()
      .then(reset)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load the settings'));
  }, []);

  if (loadError) return <div className="settings-view"><p className="error" role="alert">{loadError}</p></div>;
  if (!household) return <div className="settings-view"><div className="skeleton" aria-busy="true">Loading settings…</div></div>;

  const switchCountry = (next: Country) => {
    setCountry(next);
    // Preferred chains belong to one country.
    if (next !== household.country) setChains(new Set());
    else setChains(new Set(household.preferredChains));
    setStatus(null);
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setStatus({ kind: 'error', text: 'This browser cannot share its location. Pick the nearest city instead.' });
      return;
    }
    setStatus({ kind: 'info', text: 'Finding your location…' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = Math.round(coords.latitude * 10_000) / 10_000;
        const lng = Math.round(coords.longitude * 10_000) / 10_000;
        setLocation({ lat, lng, label: `My location (${lat.toFixed(2)}, ${lng.toFixed(2)})` });
        setStatus(null);
      },
      () => setStatus({ kind: 'error', text: 'Could not get your location. Pick the nearest city instead.' }),
      { enableHighAccuracy: false, timeout: 15_000 },
    );
  };

  const toggleChain = (id: string) =>
    setChains((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const marketChanged = country !== household.country || (country === 'SE' && !sameLocation(location, household.location));
  const canSave = country === 'DK' || location !== null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const saved = await saveHousehold({ country, location: country === 'SE' ? location : null, preferredChains: [...chains] });
      reset(saved);
      onSaved(saved);
      setStatus({
        kind: 'ok',
        text: marketChanged
          ? `Saved. Fetching offers ${saved.country === 'SE' ? `near ${saved.location?.label}` : 'in Denmark'}; this takes a minute or two. Next Sunday's plan uses them, or ask the chat for a new plan now.`
          : 'Saved.',
      });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Saving failed' });
    } finally {
      setBusy(false);
    }
  };

  const placeValue = location ? (SWEDISH_PLACES.find((p) => sameLocation(p, location))?.label ?? 'custom') : '';

  return (
    <div className="settings-view">
      <form className="panel settings" onSubmit={save}>
        <h1>Household settings</h1>
        <p className="muted">These apply to everyone in your household. Plans are made from the offers of the stores near you.</p>

        <fieldset>
          <legend>Where do you live?</legend>
          <div className="week-switch" role="radiogroup" aria-label="Country">
            {(['DK', 'SE'] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={country === c} className={country === c ? 'active' : ''} onClick={() => switchCountry(c)}>
                {COUNTRY_LABELS[c]}
              </button>
            ))}
          </div>
          {country === 'DK' && <p className="muted small">Danish chains have the same offers nationwide, so no location is needed.</p>}
        </fieldset>

        {country === 'SE' && (
          <fieldset>
            <legend>Where do you shop?</legend>
            <p className="muted small">Swedish stores have their own weekly offers, so we use the nearest store of each chain (within 15 km).</p>
            <div className="location-row">
              <select
                aria-label="Nearest city"
                value={placeValue}
                onChange={(e) => setLocation(SWEDISH_PLACES.find((p) => p.label === e.target.value) ?? location)}
              >
                <option value="" disabled>
                  Pick the nearest city
                </option>
                {placeValue === 'custom' && <option value="custom">{location?.label}</option>}
                {SWEDISH_PLACES.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary" onClick={useMyLocation}>
                Use my location
              </button>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>Preferred stores</legend>
          <p className="muted small">Leave all unticked to use every store.</p>
          <ul className="checklist chain-list">
            {household.chains[country].map((chain) => (
              <li key={chain.id}>
                <label>
                  <input type="checkbox" checked={chains.has(chain.id)} onChange={() => toggleChain(chain.id)} />
                  <span className="item-text">{chain.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="settings-actions">
          <button className="primary" disabled={busy || !canSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {!canSave && <span className="muted small">Choose where you shop first.</span>}
        </div>
        {status && (
          <p className={status.kind === 'error' ? 'error' : 'muted'} role={status.kind === 'error' ? 'alert' : 'status'}>
            {status.text}
          </p>
        )}
      </form>
    </div>
  );
}
