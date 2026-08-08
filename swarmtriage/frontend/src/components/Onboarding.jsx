import { useCallback, useEffect, useState } from 'react';
import {
  createOnboardingPlan,
  listOnboardingPlans,
  getOnboardingPlan,
  setOnboardingTaskStatus,
  getOnboardingAudit,
  ONBOARDING_ROLES,
} from '../api.js';

const ROLES = Array.isArray(ONBOARDING_ROLES) && ONBOARDING_ROLES.length
  ? ONBOARDING_ROLES
  : ['Support Agent', 'Engineer', 'Finance Analyst', 'People Ops', 'Sales Rep'];

const AGENT_META = {
  coordinator: { name: 'Coordinator', color: 'bg-accent', ring: 'border-accent/50' },
  system: { name: 'System', color: 'bg-muted', ring: 'border-muted/50' },
};

function agentMeta(agent) {
  return AGENT_META[agent] || AGENT_META.system;
}

function formatTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setUTCDate(d.getUTCDate() + (days || 0));
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function taskProgress(plan) {
  const total = (plan.tasks || []).length;
  const done = (plan.tasks || []).filter((t) => t.status === 'done').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function PlanStatusChip({ status }) {
  const map = {
    active: 'border-ochre/50 text-ochre',
    completed: 'border-olive/50 text-olive',
  };
  return (
    <span className={`chip capitalize ${map[status] || 'text-muted'}`}>{status || 'unknown'}</span>
  );
}

function TaskStatusChip({ status }) {
  const map = {
    pending: 'text-muted',
    in_progress: 'border-ochre/50 text-ochre',
    done: 'border-olive/50 text-olive',
    blocked: 'border-brick/50 text-brick',
  };
  return (
    <span className={`chip ${map[status] || 'text-muted'}`}>
      {(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-tint">
        <div
          className="h-full rounded-full bg-olive transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs text-muted">
        {done}/{total}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left rail — new plan form
// ---------------------------------------------------------------------------

function NewPlanForm({ onCreated }) {
  const [hireName, setHireName] = useState('');
  const [role, setRole] = useState(ROLES[0]);
  const [startDate, setStartDate] = useState(todayStr());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!hireName.trim()) {
      setError('Please enter the new hire\u2019s name.');
      return;
    }
    if (!startDate) {
      setError('Please pick a start date.');
      return;
    }
    setSubmitting(true);
    try {
      const plan = await createOnboardingPlan(hireName.trim(), role, startDate, notes.trim() || null);
      setHireName('');
      setNotes('');
      onCreated(plan);
    } catch (err) {
      setError(err.message || 'Could not create the plan.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className="font-serif text-base font-semibold text-ink">New onboarding plan</h3>
      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div>
          <label htmlFor="ob-name" className="label">Hire name</label>
          <input
            id="ob-name"
            className="field"
            placeholder="e.g. Ava Chen"
            value={hireName}
            onChange={(e) => setHireName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ob-role" className="label">Role</label>
          <select
            id="ob-role"
            className="field"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ob-start" className="label">Start date</label>
          <input
            id="ob-start"
            type="date"
            className="field"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ob-notes" className="label">Notes <span className="normal-case text-muted/70">(optional)</span></label>
          <textarea
            id="ob-notes"
            rows={2}
            className="field resize-y"
            placeholder="Cohort, manager, special requirements…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && <div className="error-box">{error}</div>}
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Generating plan…' : 'Generate plan'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left rail — plan list
// ---------------------------------------------------------------------------

function PlanList({ plans, selectedId, onSelect }) {
  if (!plans.length) {
    return (
      <div className="card p-6 text-center">
        <h3 className="font-serif text-base font-semibold text-ink">No plans yet</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Generate a plan above and the coordinator will sequence the tasks.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2.5">
      {plans.map((plan) => {
        const { done, total, pct } = taskProgress(plan);
        const escalations = (plan.escalations || []).length;
        const active = plan.plan_id === selectedId;
        return (
          <li key={plan.plan_id}>
            <button
              type="button"
              onClick={() => onSelect(plan.plan_id)}
              className={`card card-hover w-full p-4 text-left ${
                active ? 'border-accent/60 ring-2 ring-accent/20' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-serif text-sm font-semibold text-ink">{plan.hire_name}</span>
                <span className="chip text-muted">{plan.role}</span>
                {escalations > 0 && (
                  <span
                    className="chip ml-auto border-brick/50 text-brick"
                    title={`${escalations} escalation(s)`}
                  >
                    ⚠ {escalations}
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-tint">
                  <div className="h-full rounded-full bg-olive" style={{ width: `${pct}%` }} />
                </div>
                <span className="font-mono text-[10px] text-muted">{done}/{total}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Main — task row
// ---------------------------------------------------------------------------

function TaskRow({ plan, task, onChanged }) {
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const due = addDays(plan.start_date, task.offset_days);
  const overdue = task.status !== 'done' && todayStr() > due;

  async function advance() {
    setBusy(true);
    setError(null);
    try {
      const next = task.status === 'in_progress' ? 'done' : 'in_progress';
      await onChanged(task.task_id, next, null);
    } catch (err) {
      setError(err.message || 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmBlocked() {
    if (!reason.trim()) {
      setError('Please describe the blocker before confirming.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onChanged(task.task_id, 'blocked', reason.trim());
      setBlocking(false);
      setReason('');
    } catch (err) {
      setError(err.message || 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`card p-4 ${
        task.status === 'blocked' ? 'border-l-[3px] border-l-brick' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusChip status={task.status} />
        <span
          className={`font-serif text-sm font-semibold ${
            task.status === 'done' ? 'text-muted line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </span>
        <span className="chip text-muted">{task.owner}</span>
        <span
          className={`ml-auto font-mono text-xs ${overdue ? 'text-brick' : 'text-muted'}`}
          title={`Due ${due} (start date + ${task.offset_days} day(s))`}
        >
          due {due}
          {overdue ? ' · overdue' : ''}
        </span>
      </div>

      {task.status === 'blocked' && task.blocker_reason && (
        <p className="mt-2 text-xs leading-relaxed text-brick">
          Blocked: {task.blocker_reason}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {task.status !== 'done' && (
          <button
            type="button"
            className="btn-secondary !px-3 !py-1 text-xs"
            onClick={advance}
            disabled={busy}
          >
            {task.status === 'pending' ? 'Start task' : task.status === 'in_progress' ? 'Mark done' : 'Resume'}
          </button>
        )}
        {task.status !== 'blocked' && task.status !== 'done' && (
          <button
            type="button"
            className="btn-danger !px-3 !py-1 text-xs"
            onClick={() => {
              setBlocking((v) => !v);
              setError(null);
            }}
            disabled={busy}
          >
            Mark blocked
          </button>
        )}
        {task.status === 'done' && task.completed_at && (
          <span className="font-mono text-xs text-muted">done {formatTs(task.completed_at)}</span>
        )}
      </div>

      {blocking && (
        <div className="mt-3 rounded-lg border border-brick/40 bg-brick/[0.05] p-3">
          <label htmlFor={`blocker-${task.task_id}`} className="label">
            Blocker reason <span className="text-brick">*</span>
          </label>
          <input
            id={`blocker-${task.task_id}`}
            className="field"
            placeholder="e.g. VPN access not provisioned"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-danger !px-3 !py-1 text-xs"
              onClick={confirmBlocked}
              disabled={busy || !reason.trim()}
            >
              Confirm blocked
            </button>
            <button
              type="button"
              className="btn-secondary !px-3 !py-1 text-xs"
              onClick={() => {
                setBlocking(false);
                setReason('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-box mt-3">{error}</div>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main — plan detail
// ---------------------------------------------------------------------------

function PlanDetail({ plan, audit, onTaskChanged }) {
  const { done, total } = taskProgress(plan);
  const escalations = plan.escalations || [];
  const latest = escalations[escalations.length - 1];
  const timeline = audit?.timeline || [];

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-serif text-xl font-semibold text-ink">{plan.hire_name}</h3>
          <span className="chip text-muted">{plan.role}</span>
          <PlanStatusChip status={plan.status} />
          <span className="ml-auto font-mono text-xs text-muted">
            starts {plan.start_date}
          </span>
        </div>
        {plan.notes && (
          <p className="mt-2 text-sm leading-relaxed text-ink/80">{plan.notes}</p>
        )}
        <div className="mt-4">
          <ProgressBar done={done} total={total} />
        </div>
        {plan.generation_reasoning && (
          <details className="mt-4 rounded-lg border border-border bg-paper p-3">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-muted">
              Coordinator reasoning
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-ink/80">
              {plan.generation_reasoning}
            </p>
          </details>
        )}
      </div>

      {latest && (
        <div className="rounded-lg border border-brick/40 bg-brick/[0.07] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-brick/50 text-brick">
              ⚠ {escalations.length} escalation{escalations.length === 1 ? '' : 's'}
            </span>
            <span className="text-sm font-medium text-brick">
              Latest: “{latest.reason}”
            </span>
            <span className="ml-auto font-mono text-xs text-brick/80">
              → {latest.escalated_to}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-brick/90">
            Task “{latest.task_title}” · {formatTs(latest.timestamp)}
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {(plan.tasks || []).map((task) => (
          <TaskRow key={task.task_id} plan={plan} task={task} onChanged={onTaskChanged} />
        ))}
      </ul>

      <div className="card p-6">
        <h3 className="font-serif text-base font-semibold text-ink">Coordinator timeline</h3>
        {timeline.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No coordinator events recorded yet.</p>
        ) : (
          <ol className="relative ml-4 mt-5 space-y-5 border-l border-border pl-6">
            {timeline.map((ev, i) => {
              const meta = agentMeta(ev.agent);
              return (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 bg-surface ${meta.ring}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${meta.color}`} />
                  </span>
                  <div className="card card-hover p-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="chip text-ink">
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.color}`} />
                        {meta.name}
                      </span>
                      <span className="font-serif text-sm font-semibold text-ink">
                        {(ev.event || '').replace(/_/g, ' ')}
                      </span>
                      <span className="ml-auto font-mono text-xs text-muted">{formatTs(ev.timestamp)}</span>
                    </div>
                    {ev.detail && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">{ev.detail}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding tab
// ---------------------------------------------------------------------------

export default function Onboarding() {
  const [plans, setPlans] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [plan, setPlan] = useState(null);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState(null);

  const loadPlans = useCallback(async (keepSelection = true) => {
    try {
      const data = await listOnboardingPlans();
      const list = data.plans || [];
      setPlans(list);
      if (!keepSelection || !list.some((p) => p.plan_id === selectedId)) {
        setSelectedId(list.length ? list[0].plan_id : null);
      }
    } catch (err) {
      setError(err.message || 'Could not load onboarding plans.');
      setPlans([]);
    }
  }, [selectedId]);

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setPlan(null);
      setAudit(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [p, a] = await Promise.all([
          getOnboardingPlan(selectedId),
          getOnboardingAudit(selectedId),
        ]);
        if (!cancelled) {
          setPlan(p);
          setAudit(a);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load the plan.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function handleTaskChanged(taskId, status, blockerReason) {
    const updated = await setOnboardingTaskStatus(taskId, status, blockerReason);
    setPlan(updated);
    const [a, list] = await Promise.all([getOnboardingAudit(updated.plan_id), listOnboardingPlans()]);
    setAudit(a);
    setPlans(list.plans || []);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <NewPlanForm
          onCreated={(p) => {
            loadPlans().then(() => setSelectedId(p.plan_id));
          }}
        />
        {plans === null ? (
          <div className="card p-6 text-center text-sm text-muted">Loading plans…</div>
        ) : (
          <PlanList plans={plans} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </aside>

      <section>
        {error && <div className="error-box mb-4">{error}</div>}
        {plan ? (
          <PlanDetail plan={plan} audit={audit} onTaskChanged={handleTaskChanged} />
        ) : (
          <div className="card p-10 text-center">
            <h3 className="font-serif text-lg font-semibold text-ink">Select a plan</h3>
            <p className="mt-2 text-sm text-muted">
              Pick an onboarding plan on the left to track tasks, escalations and
              the coordinator timeline.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
