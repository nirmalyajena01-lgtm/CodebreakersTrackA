import { useCallback, useEffect, useState } from 'react';
import { getAudit, getTickets } from '../api.js';
import SentimentBadge from './SentimentBadge.jsx';

const AGENT_META = {
  A: { name: 'Orchestrator', color: 'bg-accent', ring: 'border-accent/50' },
  B: { name: 'Classifier', color: 'bg-ochre', ring: 'border-ochre/50' },
  C: { name: 'Router', color: 'bg-olive', ring: 'border-olive/50' },
  D: { name: 'Drafter', color: 'bg-accent-deep', ring: 'border-accent-deep/50' },
  E: { name: 'Compliance', color: 'bg-olive', ring: 'border-olive/50' },
  human: { name: 'Human Manager', color: 'bg-ochre', ring: 'border-ochre/50' },
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

function StatusChip({ status }) {
  const map = {
    approved: 'border-olive/50 text-olive',
    rejected: 'border-brick/50 text-brick',
    escalated: 'border-brick/50 text-brick',
    pending_review: 'border-ochre/50 text-ochre',
    processing: 'border-accent/40 text-accent',
  };
  return (
    <span className={`chip capitalize ${map[status] || 'text-muted'}`}>
      {(status || 'unknown').replace('_', ' ')}
    </span>
  );
}

function AuditSummary({ audit }) {
  const sentiment = audit.agent_b_sentiment_score_and_reasoning || {};
  const compliance = audit.agent_d_compliance_check_score || [];
  const drafts = audit.agent_c_draft_variations_thought_process || [];
  const rejections = audit.rejection_feedback_log || [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="card p-5">
        <h3 className="font-serif text-base font-semibold text-ink">Ticket outcome</h3>
        <dl className="mt-3 space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Final status</dt>
            <dd><StatusChip status={audit.final_status} /></dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Ingested</dt>
            <dd className="font-mono text-xs text-ink">{formatTs(audit.ingestion_timestamp)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Human approval</dt>
            <dd className="font-mono text-xs text-ink">{audit.human_approval_timestamp ? formatTs(audit.human_approval_timestamp) : 'not yet'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Sentiment</dt>
            <dd>
              {sentiment.score != null ? (
                <SentimentBadge sentiment={sentiment.score >= 7 ? 'Anger' : sentiment.score >= 4 ? 'Neutral' : 'Happy'} score={sentiment.score} />
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
        </dl>
        {audit.agent_a_classification_reasoning && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Classification reasoning</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/80">{audit.agent_a_classification_reasoning}</p>
          </div>
        )}
        {sentiment.reasoning && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Sentiment reasoning</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/80">{sentiment.reasoning}</p>
          </div>
        )}
      </div>

      <div className="card p-5">
        <h3 className="font-serif text-base font-semibold text-ink">Drafts &amp; compliance</h3>
        <div className="mt-3 space-y-3">
          {drafts.length === 0 && compliance.length === 0 && (
            <p className="text-sm text-muted">No drafts recorded yet.</p>
          )}
          {drafts.map((d) => {
            const c = compliance.find((x) => x.style === d.style) || {};
            const ok = c.score != null && c.score >= 80 && c.passed !== false;
            return (
              <div key={d.style} className="rounded-lg border border-border bg-paper p-3">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-sm font-semibold capitalize text-ink">{d.style}</span>
                  {c.score != null && (
                    <span
                      className={`chip ${
                        ok
                          ? 'border-olive/50 text-olive'
                          : 'border-brick/50 text-brick'
                      }`}
                    >
                      {c.passed === false ? 'failed' : 'passed'} · {c.score}
                    </span>
                  )}
                </div>
                {d.thought_process && (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink/80">
                    <span className="font-medium text-muted">Drafter: </span>
                    {d.thought_process}
                  </p>
                )}
                {c.reasoning && (
                  <p className="mt-1 text-xs leading-relaxed text-ink/80">
                    <span className="font-medium text-muted">Compliance: </span>
                    {c.reasoning}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {rejections.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Rejection feedback log</p>
            <ul className="mt-2 space-y-1.5">
              {rejections.map((r, i) => (
                <li key={i} className="rounded-lg border border-brick/30 bg-brick/[0.05] p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-brick">{r.reason}</span>
                    <span className="font-mono text-muted">{formatTs(r.timestamp)}</span>
                  </div>
                  {r.free_text && <p className="mt-1 text-ink/80">{r.free_text}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ events }) {
  if (!events || events.length === 0) {
    return <div className="card p-8 text-center text-sm text-muted">No audit events recorded for this ticket.</div>;
  }
  return (
    <ol className="relative ml-4 space-y-6 border-l border-border pl-6">
      {events.map((ev, i) => {
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
                  Agent {ev.agent} · {meta.name}
                </span>
                <span className="font-serif text-sm font-semibold text-ink">{ev.event}</span>
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
  );
}

export default function AuditTrail() {
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [audit, setAudit] = useState(null);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      setLoadingTickets(true);
      try {
        const data = await getTickets();
        const list = data.tickets || [];
        setTickets(list);
        if (list.length > 0) setSelectedId(list[0].ticket_id);
      } catch (err) {
        setError(err.message || 'Failed to load tickets.');
      } finally {
        setLoadingTickets(false);
      }
    })();
  }, []);

  const loadAudit = useCallback(async (id) => {
    if (!id) return;
    setLoadingAudit(true);
    setError(null);
    try {
      const data = await getAudit(id);
      setAudit(data);
    } catch (err) {
      setAudit(null);
      setError(err.message || 'Failed to load audit trail.');
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    loadAudit(selectedId);
  }, [selectedId, loadAudit]);

  const selectedTicket = tickets.find((t) => t.ticket_id === selectedId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-xl font-semibold text-ink">Audit Trail</h2>
        <span className="text-sm text-muted">Follow every agent's logic, end to end.</span>
        <div className="ml-auto">
          <select
            className="field w-auto min-w-[16rem]"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={loadingTickets || tickets.length === 0}
            aria-label="Select ticket"
          >
            {tickets.length === 0 && <option value="">No tickets yet</option>}
            {tickets.map((t) => (
              <option key={t.ticket_id} value={t.ticket_id}>
                #{t.ticket_id.slice(0, 8)} — {t.category || 'unclassified'} ({(t.final_status || '').replace('_', ' ')})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="error-box">
          {error}
        </div>
      )}

      {selectedTicket && (
        <blockquote className="card p-4 text-sm leading-relaxed text-ink/90">
          <span className="mr-2 text-xs font-medium uppercase tracking-wider text-muted">Original message</span>
          {selectedTicket.raw_text}
        </blockquote>
      )}

      {loadingAudit ? (
        <div className="card p-10 text-center text-sm text-muted">Retrieving the flight recorder…</div>
      ) : audit ? (
        <>
          <AuditSummary audit={audit} />
          <div>
            <h3 className="mb-4 font-serif text-base font-semibold text-ink">
              Swarm timeline
            </h3>
            <Timeline events={audit.timeline} />
          </div>
        </>
      ) : (
        !error && (
          <div className="card p-10 text-center text-sm text-muted">
            {loadingTickets ? 'Loading tickets…' : 'Select a ticket to inspect its audit trail.'}
          </div>
        )
      )}
    </div>
  );
}
