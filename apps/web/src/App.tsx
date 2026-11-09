import { useEffect, useState } from 'react';
import { getHousehold, type Household } from './api';
import { currentUser, logOut, type User } from './auth';
import { ChatView } from './components/ChatView';
import { Login } from './components/Login';
import { PlanView } from './components/PlanView';
import { SettingsView } from './components/SettingsView';

const TABS = ['plan', 'chat', 'settings'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { plan: 'Plan', chat: 'Chat', settings: 'Settings' };
const tabFromHash = (): Tab => TABS.find((t) => location.hash === `#${t}`) ?? 'plan';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [planVersion, setPlanVersion] = useState(0);
  const [household, setHousehold] = useState<Household | null>(null);

  useEffect(() => {
    void currentUser().then(setUser);
  }, []);

  useEffect(() => {
    // Only used to nudge a Swedish household without a location; a failure just hides the nudge.
    if (user) void getHousehold().then(setHousehold, () => setHousehold(null));
  }, [user]);

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (user === undefined) return <div className="splash" aria-busy="true">🍲</div>;
  if (user === null) return <Login onSignedIn={() => void currentUser().then(setUser)} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span aria-hidden>🍲</span> What's for dinner
        </div>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
        <button
          className="link"
          onClick={async () => {
            await logOut();
            setUser(null);
          }}
        >
          Sign out
        </button>
      </header>

      {/* Both views stay mounted so switching tabs keeps the chat and scroll position. */}
      <main className={tab === 'plan' ? 'view' : 'view hidden'}>
        <PlanView refreshKey={planVersion} needsSetup={household?.ready === false} onOpenSettings={() => setTab('settings')} />
      </main>
      <main className={tab === 'chat' ? 'view view-chat' : 'view view-chat hidden'}>
        <ChatView userName={user.name} onPlanChanged={() => setPlanVersion((v) => v + 1)} />
      </main>
      {tab === 'settings' && (
        <main className="view">
          <SettingsView onSaved={setHousehold} />
        </main>
      )}
    </div>
  );
}
