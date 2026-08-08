import { useCallback, useEffect, useRef, useState } from 'react';
import { approveTicket, getQueue, rejectTicket } from '../api.js';
import DraftCard from './DraftCard.jsx';
import RejectFeedbackModal from './RejectFeedbackModal.jsx';
import SentimentBadge from './SentimentBadge.jsx';

const POLL_MS = 5000;

function defaultSelectedStyle(ticket) {
  const drafts = ticket.drafts || [];
  const passing = drafts.find((d) => d.compliance_passed);
  return (passing || drafts[0] || {}).style || null;
}

function TicketCard({ ticket, onChanged }) {
  const [selectedStyle, setSelectedStyle] = useState(() => defaultSelectedStyle(ticket));
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const selectedDraft = (ticket.drafts || []).find((d) => d.style === selectedStyle) || ticket.drafts?.[0];

  function startEdit() {
    if (!selectedDraft) return;
    setEditedText(selectedDraft.text);
    setEditing(true);
  }

  async function handleApprove() {
    if (!selectedDraft) return;
    setBusy(true);
    setError(null);
    try {
      const edited = editing && editedText.trim() !== selectedDraft.text ? editedText.trim() : null;
      await approveTicket(ticket.ticket_id, selectedDraft.style, edited);
      onChanged();
    } catch (err) {
      setError(err.message || 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(reason, freeText) {
    setBusy(true);
    setError(null);
    try {
      await rejectTicket(ticket.ticket_id, reason, freeText);
      setRejectOpen(false);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.message || 'Rejection failed.');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-xs text-muted">#{ticket.ticket_id.slice(0, 8)}</span>
        <SentimentBadge sentiment={ticket.sentiment} score={ticket.sentiment_score} />
        {ticket.category && (
          <span className="chip border-accent/40 text-accent">{ticket.category}</span>
        )}
        {ticket.final_status === 'escalated' && (
          <span className="chip border-brick/50 text-brick">escalated</span>
        )}
        {(ticket.rejection_feedback_log || []).length > 0 && (
          <span className="chip border-ochre/50 text-ochre">
            redrafted ×{ticket.rejection_feedback_log.length}
          </span>
        )}
        <span className="ml-auto text-xs text-muted">
          approver: <span className="font-mono text-ink">{ticket.assigned_approver || '—'}</span>
        </span>
      </header>

      <blockquote className="mt-3 rounded-lg border border-border bg-paper p-3 text-sm leading-relaxed text-ink/90">
        {ticket.raw_text}
      </blockquote>

      {ticket.rag_feedback_used && ticket.rag_feedback_used.length > 0 && (
        <div className="mt-3 rounded-lg border border-olive/40 bg-olive/[0.06] p-3 text-xs text-olive">
          <span className="font-semibold">Swarm memory applied:</span>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-olive/90">
            {ticket.rag_feedback_used.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {(ticket.drafts || []).map((draft) => (
          <DraftCard
            key={draft.style}
            draft={draft}
            selected={selectedStyle === draft.style}
            onSelect={setSelectedStyle}
            disabled={busy}
          />
        ))}
      </div>

      {editing && selectedDraft && (
        <div className="mt-4">
          <label className="label">
            Edit {selectedDraft.style} draft — approving will send this version
          </label>
          <textarea
            rows={5}
            className="field resize-y"
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
          />
        </div>
      )}

      {error && (
        <div className="error-box mt-3">
          {error}
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {editing ? (
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={busy}>
            Cancel edit
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={startEdit} disabled={busy || !selectedDraft}>
            Edit
          </button>
        )}
        <button type="button" className="btn-danger" onClick={() => setRejectOpen(true)} disabled={busy}>
          Reject &amp; Provide Feedback
        </button>
        <button type="button" className="btn-primary" onClick={handleApprove} disabled={busy || !selectedDraft}>
          {busy ? 'Working…' : editing ? 'Approve edited draft' : 'Approve'}
        </button>
      </footer>

      <RejectFeedbackModal
        open={rejectOpen}
        ticketId={ticket.ticket_id}
        submitting={busy}
        onCancel={() => setRejectOpen(false)}
        onSubmit={handleReject}
      />
    </article>
  );
}

export default function ReviewQueue() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastPoll, setLastPoll] = useState(null);
  const timerRef = useRef(null);

  const refresh = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const data = await getQueue();
      setTickets(data.tickets || []);
      setError(null);
      setLastPoll(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load queue.');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(true);
    timerRef.current = setInterval(() => refresh(false), POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-xl font-semibold text-ink">Manager Review Queue</h2>
        <span className="chip text-muted">
          {tickets.length} pending
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <span className="h-2 w-2 rounded-full bg-olive" />
          auto-refreshing every 5s
          {lastPoll && <span className="text-muted/70">· last {lastPoll.toLocaleTimeString()}</span>}
        </span>
      </div>

      {error && (
        <div className="error-box">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-sm text-muted">Contacting the swarm…</div>
      ) : tickets.length === 0 ? (
        <div className="card p-10 text-center">
          <svg className="mx-auto h-8 w-8 text-olive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 11.5a9.5 9.5 0 11-4.4-8" />
            <path d="M22 4L12 14l-3-3" />
          </svg>
          <p className="mt-2 font-serif text-base font-semibold text-ink">Queue is clear</p>
          <p className="mt-1 text-sm text-muted">No tickets awaiting review.</p>
        </div>
      ) : (
        tickets.map((t) => <TicketCard key={t.ticket_id} ticket={t} onChanged={() => refresh(false)} />)
      )}
    </div>
  );
}
