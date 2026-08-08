import { useCallback, useEffect, useRef, useState } from 'react';
import { getCaptcha, login, signup } from '../api.js';

function WordmarkMark() {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-on-accent" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="12" r="2.2" />
        <circle cx="19" cy="6" r="2.2" />
        <circle cx="19" cy="18" r="2.2" />
        <path d="M7 11l10-4M7 13l10 4" />
      </svg>
    </span>
  );
}

function RefreshButton({ onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="Get a new captcha"
      aria-label="Refresh captcha"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors duration-150 hover:bg-tint hover:text-ink disabled:opacity-40"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}

// Captcha box: the demo backend generates the 5-character code client-side
// (A-Z0-9 minus 0/O/1/I) and we draw it onto a canvas — jittered characters
// and noise lines, warm ink on a tint background (SPEC_AUTH_ONBOARDING §1/§4).
function drawCaptcha(canvas, code) {
  const w = 150;
  const h = 46;
  const scale = 2;
  canvas.width = w * scale;
  canvas.height = h * scale;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // warm tint background
  ctx.fillStyle = '#F0E8D8';
  ctx.fillRect(0, 0, w, h);

  const palette = ['#C0563B', '#6B7A4F', '#C98A2C', '#B04A3A', '#7C6F5F'];

  // noise curves
  for (let i = 0; i < 5; i += 1) {
    ctx.strokeStyle = palette[i % palette.length];
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.random() * w, Math.random() * h);
    ctx.bezierCurveTo(
      Math.random() * w, Math.random() * h,
      Math.random() * w, Math.random() * h,
      Math.random() * w, Math.random() * h,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // jittered characters
  code.split('').forEach((ch, i) => {
    const x = 15 + i * 27 + (Math.random() * 7 - 3.5);
    const y = h / 2 + 9 + (Math.random() * 7 - 3.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * 0.5 - 0.25);
    ctx.font = `${Math.random() < 0.5 ? 600 : 700} ${23 + Math.floor(Math.random() * 4)}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = Math.random() < 0.72 ? '#2E2620' : palette[Math.floor(Math.random() * 4)];
    ctx.textAlign = 'center';
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });

  // speckle noise
  ctx.fillStyle = '#2E2620';
  for (let i = 0; i < 34; i += 1) {
    ctx.globalAlpha = 0.12;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.3, 1.3);
  }
  ctx.globalAlpha = 1;
}

function CaptchaBox({ captcha, onRefresh, busy }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (captcha && canvasRef.current) {
      drawCaptcha(canvasRef.current, captcha.code);
      // e2e/demo convenience hook: lets automated checks read the current code
      window.__swarmtriageDemoCaptcha = captcha.code;
    }
  }, [captcha]);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-[52px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-tint px-2">
        {captcha ? (
          <canvas ref={canvasRef} role="img" aria-label="Captcha image" />
        ) : (
          <span className="text-xs text-muted">Loading captcha…</span>
        )}
      </div>
      <RefreshButton onClick={onRefresh} busy={busy} />
    </div>
  );
}

export default function AuthScreen({ onAuth }) {
  const [role, setRole] = useState('customer'); // 'customer' | 'employee'
  const [mode, setMode] = useState('login'); // customer only: 'signup' | 'login'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaText, setCaptchaText] = useState('');
  const [captcha, setCaptcha] = useState(null);
  const [busy, setBusy] = useState(false);
  const [captchaBusy, setCaptchaBusy] = useState(false);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaBusy(true);
    try {
      const c = await getCaptcha();
      if (mounted.current) {
        setCaptcha(c);
        setCaptchaText('');
      }
    } catch {
      if (mounted.current) setCaptcha(null);
    } finally {
      if (mounted.current) setCaptchaBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshCaptcha();
  }, [refreshCaptcha, role, mode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!captcha) {
      setError('Captcha is still loading — one moment.');
      return;
    }
    if (!captchaText.trim()) {
      setError('Please enter the captcha text.');
      return;
    }
    setBusy(true);
    try {
      const result =
        role === 'customer' && mode === 'signup'
          ? await signup(name, email, password, captcha.captcha_id, captchaText)
          : await login(email, password, captcha.captcha_id, captchaText);
      onAuth(result);
    } catch (err) {
      setError(err.message || 'Authentication failed.');
      refreshCaptcha();
    } finally {
      setBusy(false);
    }
  }

  const isSignup = role === 'customer' && mode === 'signup';

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-tint p-12 lg:flex">
        <div className="flex items-center gap-3">
          <WordmarkMark />
          <div>
            <p className="font-serif text-2xl font-semibold leading-tight tracking-tight text-ink">
              Swarm<span className="text-accent">Triage</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted">
              Adaptive Support Automation
            </p>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="font-serif text-4xl font-semibold leading-[1.15] tracking-tight text-ink">
            Every customer message, triaged by a swarm that never sleeps.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Specialized agents classify, route, draft and compliance-check every
            ticket in seconds — humans keep the final word.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            {[
              'Five-agent pipeline with full audit trail',
              'Swarm memory that learns from every rejection',
              'Onboarding coordinator that escalates blockers itself',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted/70">Warm paper, sharp agents.</p>
      </aside>

      {/* Auth card */}
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <WordmarkMark />
            <div>
              <p className="font-serif text-xl font-semibold leading-tight tracking-tight text-ink">
                Swarm<span className="text-accent">Triage</span>
              </p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted">
                Adaptive Support Automation
              </p>
            </div>
          </div>

          <div className="card p-7">
            {/* Role tabs */}
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-paper p-1">
              {['customer', 'employee'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRole(r);
                    setError(null);
                  }}
                  className={`rounded-md px-3 py-2 font-serif text-sm font-semibold capitalize transition-colors duration-150 ${
                    role === r ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            {role === 'customer' && (
              <div className="mt-4 flex justify-center gap-6 border-b border-border">
                {[
                  { id: 'signup', label: 'Sign up' },
                  { id: 'login', label: 'Log in' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setMode(m.id);
                      setError(null);
                    }}
                    className={`-mb-px border-b-2 px-1 pb-2 text-sm transition-colors duration-150 ${
                      mode === m.id
                        ? 'border-accent font-medium text-ink'
                        : 'border-transparent text-muted hover:text-ink'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            <h2 className="mt-5 font-serif text-lg font-semibold text-ink">
              {role === 'employee'
                ? 'Employee sign in'
                : isSignup
                  ? 'Create your customer account'
                  : 'Welcome back'}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {role === 'employee'
                ? 'Access the review queue, audit trail and onboarding coordinator.'
                : isSignup
                  ? 'Submit tickets and follow their triage in real time.'
                  : 'Log in to submit tickets and check their status.'}
            </p>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              {isSignup && (
                <div>
                  <label htmlFor="auth-name" className="label">Full name</label>
                  <input
                    id="auth-name"
                    className="field"
                    placeholder="e.g. Jordan Lee"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              )}
              <div>
                <label htmlFor="auth-email" className="label">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  className="field"
                  placeholder={role === 'employee' ? 'you@company.com' : 'you@example.com'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="auth-password" className="label">Password</label>
                <input
                  id="auth-password"
                  type="password"
                  className="field"
                  placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                />
              </div>
              <div>
                <label htmlFor="auth-captcha" className="label">Captcha</label>
                <CaptchaBox captcha={captcha} onRefresh={refreshCaptcha} busy={captchaBusy} />
                <input
                  id="auth-captcha"
                  className="field mt-2"
                  placeholder="Type the 5 characters"
                  value={captchaText}
                  onChange={(e) => setCaptchaText(e.target.value)}
                  autoComplete="off"
                  maxLength={8}
                />
              </div>
              {error && <div className="error-box">{error}</div>}
              <button type="submit" className="btn-primary w-full" disabled={busy || captchaBusy}>
                {busy
                  ? 'One moment…'
                  : isSignup
                    ? 'Create account'
                    : 'Log in'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
