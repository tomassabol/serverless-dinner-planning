import { useState, type FormEvent } from 'react';
import { completeNewPassword, completeTotp, startSignIn, type SignInStep } from '../auth';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<Exclude<SignInStep, 'done'> | 'credentials'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (event: FormEvent, action: () => Promise<SignInStep>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next === 'done') onSignedIn();
      else setStep(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand brand-large">
          <span aria-hidden>🍲</span> What's for dinner
        </div>
        <p className="muted">Weekly dinners built from Danish supermarket offers.</p>

        {step === 'credentials' && (
          <form onSubmit={(e) => run(e, () => startSignIn(email, password))}>
            <label>
              Email
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Password
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )}

        {step === 'newPassword' && (
          <form onSubmit={(e) => run(e, () => completeNewPassword(newPassword, name))}>
            <p>Welcome! Choose your own password and tell us what to call you.</p>
            <label>
              Your first name
              <input autoComplete="given-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              New password
              <input type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <small className="muted">At least 12 characters with upper and lower case letters and a number.</small>
            </label>
            <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={(e) => run(e, () => completeTotp(code))}>
            <label>
              Code from your authenticator app
              <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
          </form>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
