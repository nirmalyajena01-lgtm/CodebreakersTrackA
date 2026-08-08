import { useCallback, useEffect, useState } from 'react';
import { getTickets } from '../api.js';
import SentimentBadge from './SentimentBadge.jsx';

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
      {(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

export default function MyTickets({ user }) {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState(null);

  const email = (user?.email || '').toLowerCase();

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getTickets();
      const mine = (data.tickets || [])
        .filter((t) => (t.customer_email || '').toLowerCase() === email)
        .sort((a, b) => (a.ingestion_timestamp < b.ingestion_timestamp ? 1 : -1));
      setTickets(mine);
    } catch (err) {
      setError(err.message || 'Could not load your tickets.');
      setTickets([]);
    }
  }, [email]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-ink">My Tickets</h2>
          <p className="mt-1 text-sm text-muted">
            Everything you have submitted, with its live triage status.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {tickets === null ? (
        <div className="card p-10 text-center text-sm text-muted">Loading your tickets…</div>
      ) : tickets.length === 0 ? (
        <div className="card p-10 text-center">
          <h3 className="font-serif text-lg font-semibold text-ink">No tickets yet</h3>
          <p className="mt-2 text-sm text-muted">
            When you submit a request it will appear here the moment our swarm
            has triaged it.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => (
            <li key={t.ticket_id} className="card card-hover p-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={t.final_status} />
                {t.category && <span className="chip text-muted">{t.category}</span>}
                {t.sentiment && (
                  <SentimentBadge sentiment={t.sentiment} score={t.sentiment_score} />
                )}
                <span className="ml-auto font-mono text-xs text-muted">
                  {formatTs(t.ingestion_timestamp)}
                </span>
              </div>
              <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">
                {t.raw_text}
              </p>
              {t.final_status === 'approved' && t.approved_draft_style && (
                <p className="mt-2 text-xs text-olive">
                  Replied ({t.approved_draft_style} draft approved)
                  {t.human_approval_timestamp ? ` · ${formatTs(t.human_approval_timestamp)}` : ''}
                </p>
              )}
              <p className="mt-2 font-mono text-[10px] text-muted/70">
                ref {t.ticket_id}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
