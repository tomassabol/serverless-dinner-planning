import { useEffect, useState } from 'react';
import { currentUser, logOut, type User } from './auth';
import { ChatView } from './components/ChatView';
import { Login } from './components/Login';
import { PlanView } from './components/PlanView';

type Tab = 'plan' | 'chat';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#chat' ? 'chat' : 'plan'));
  const [planVersion, setPlanVersion] = useState(0);

  useEffect(() => {
    void currentUser().then(setUser);
  }, []);

  useEffect(() => {
    history.replaceState(null, '', tab === 'chat' ? '#chat' : '#plan');
  }, [tab]);

  useEffect(() => {
    const onHashChange = () => setTab(location.hash === '#chat' ? 'chat' : 'plan');
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
          <button role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>
            Plan
          </button>
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            Chat
          </button>
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
        <PlanView refreshKey={planVersion} />
      </main>
      <main className={tab === 'chat' ? 'view view-chat' : 'view view-chat hidden'}>
        <ChatView userName={user.name} onPlanChanged={() => setPlanVersion((v) => v + 1)} />
      </main>
    </div>
  );
}
