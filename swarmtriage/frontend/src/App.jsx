import { useEffect, useState } from 'react';
import { getHealth, getMe, setAuthToken } from './api.js';
import AuthScreen from './components/AuthScreen.jsx';
import NewTicketForm from './components/NewTicketForm.jsx';
import MyTickets from './components/MyTickets.jsx';
import ReviewQueue from './components/ReviewQueue.jsx';
import AuditTrail from './components/AuditTrail.jsx';
import Onboarding from './components/Onboarding.jsx';

const SESSION_KEY = 'swarmtriage_session';

const TABS_BY_ROLE = {
  customer: [
    { id: 'new', label: 'New Ticket', subtitle: 'Intake' },
    { id: 'mine', label: 'My Tickets', subtitle: 'Status' },
  ],
  employee: [
    { id: 'queue', label: 'Review Queue', subtitle: 'Manager' },
    { id: 'audit', label: 'Audit Trail', subtitle: 'Trace' },
    { id: 'onboarding', label: 'Onboarding', subtitle: 'Coordinator' },
  ],
};

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="12" r="2.2" />
          <circle cx="19" cy="6" r="2.2" />
          <circle cx="19" cy="18" r="2.2" />
          <path d="M7 11l10-4M7 13l10 4" />
        </svg>
      </span>
      <div>
        <h1 className="font-serif text-xl font-semibold leading-tight tracking-tight text-ink">
          Swarm<span className="text-accent">Triage</span>
        </h1>
        <p className="-mt-0.5 text-[10px] uppercase tracking-[0.2em] text-muted">
          Adaptive Support Automation
        </p>
      </div>
    </div>
  );
}

function Header({ user, health, onLogout }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <Wordmark />
        <div className="ml-auto flex items-center gap-3 text-xs">
          {/* subtle status dot — olive when the backend answers, brick otherwise */}
          <span
            className={`h-2 w-2 rounded-full ${health ? 'bg-olive' : 'bg-brick'}`}
            title={health ? 'Backend online' : 'Backend unreachable'}
            aria-label={health ? 'Backend online' : 'Backend unreachable'}
          />
          <span className="chip text-muted" title={`Signed in as ${user.email}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
            </svg>
            <span className="text-ink">{user.name}</span>
            <span className="uppercase tracking-wider">{user.role}</span>
          </span>
          <button type="button" className="btn-secondary !px-3 !py-1 text-xs" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState('new');
  const [health, setHealth] = useState(null);

  // Restore the persisted session and validate it against /api/auth/me.
  // A 401 means the token is dead — clear the session and re-gate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      } catch {
        stored = null;
      }
      if (stored && stored.token && stored.user) {
        setAuthToken(stored.token);
        try {
          const { user } = await getMe();
          if (!cancelled) {
            const next = { token: stored.token, user };
            try {
              localStorage.setItem(SESSION_KEY, JSON.stringify(next));
            } catch {
              // storage full/unavailable — session still works in memory
            }
            setSession(next);
          }
        } catch (err) {
          if (!cancelled) {
            if (err && err.status === 401) {
              try {
                localStorage.removeItem(SESSION_KEY);
              } catch {
                // ignore
              }
              setAuthToken(null);
            } else {
              setSession(stored); // transient failure — keep the stored session
            }
          }
        }
      }
      if (!cancelled) setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Health ping drives the header status dot (no text pill).
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const h = await getHealth();
        if (!cancelled) setHealth(h);
      } catch {
        if (!cancelled) setHealth(null);
      }
    };
    ping();
    const t = setInterval(ping, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Role-appropriate default tab whenever the session (role) changes.
  useEffect(() => {
    if (session) setTab(session.user.role === 'employee' ? 'queue' : 'new');
  }, [session]);

  function handleAuth({ token, user }) {
    const next = { token, user };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      // ignore — in-memory session still works
    }
    setAuthToken(token);
    setSession(next);
  }

  function handleLogout() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    setAuthToken(null);
    setSession(null);
  }

  if (!checked) {
    return <div className="min-h-screen" />;
  }

  if (!session) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  const tabs = TABS_BY_ROLE[session.user.role] || TABS_BY_ROLE.customer;

  return (
    <div className="min-h-screen pb-16">
      <Header user={session.user} health={health} onLogout={handleLogout} />

      <nav className="mx-auto mt-6 flex max-w-6xl gap-6 border-b border-border px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-1 pb-2.5 pt-1 text-left transition-colors duration-150 ${
              tab === t.id
                ? 'border-accent text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <span className="block font-serif text-base font-semibold">{t.label}</span>
            <span className="block text-[10px] uppercase tracking-[0.18em] text-muted">{t.subtitle}</span>
          </button>
        ))}
      </nav>

      <main className="mx-auto mt-6 max-w-6xl px-4">
        {tab === 'new' && <NewTicketForm lockedEmail={session.user.email} />}
        {tab === 'mine' && <MyTickets user={session.user} />}
        {tab === 'queue' && <ReviewQueue />}
        {tab === 'audit' && <AuditTrail />}
        {tab === 'onboarding' && <Onboarding />}
      </main>
    </div>
  );
}
