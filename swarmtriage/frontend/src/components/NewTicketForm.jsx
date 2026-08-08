import { useEffect, useState } from 'react';
import { submitTicket } from '../api.js';
import SentimentBadge from './SentimentBadge.jsx';

export default function NewTicketForm({ lockedEmail } = {}) {
  const [rawText, setRawText] = useState('');
  const [email, setEmail] = useState(lockedEmail || '');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // When the session fixes the sender (customer role), keep the field in sync.
  useEffect(() => {
    if (lockedEmail) setEmail(lockedEmail);
  }, [lockedEmail]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!rawText.trim()) {
      setError('Please describe the issue before submitting.');
      return;
    }
    if (!email.trim()) {
      setError('Please provide a customer email.');
      return;
    }
    setSubmitting(true);
    try {
      const ticket = await submitTicket(rawText.trim(), email.trim());
      setResult(ticket);
      setRawText('');
    } catch (err) {
      setError(err.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="card p-6">
        <h2 className="font-serif text-xl font-semibold text-ink">Submit a Support Ticket</h2>
        <p className="mt-1 text-sm text-muted">
          Our agent swarm will classify, route and draft a reply in seconds.
        </p>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="ticket-text" className="label">
              Describe your issue
            </label>
            <textarea
              id="ticket-text"
              rows={6}
              className="field resize-y"
              placeholder="e.g. I was charged twice this month and nobody has replied to my emails…"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="ticket-email" className="label">
              {lockedEmail ? 'Your email' : 'Customer email'}
            </label>
            <input
              id="ticket-email"
              type="email"
              className={`field ${lockedEmail ? 'opacity-70' : ''}`}
              placeholder="customer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={Boolean(lockedEmail)}
            />
          </div>
          {error && (
            <div className="error-box">
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Swarm is working…' : 'Launch into the swarm'}
            </button>
          </div>
        </form>
      </div>

      {result && (
        <div className="card border-olive/40 p-6">
          <div className="flex items-center gap-2 text-olive">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z" clipRule="evenodd" />
            </svg>
            <h3 className="font-serif text-base font-semibold text-ink">Ticket processed by the swarm</h3>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Ticket ID</dt>
              <dd className="mt-0.5 font-mono text-xs text-ink">{result.ticket_id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Status</dt>
              <dd className="mt-0.5 capitalize text-ink">{(result.final_status || '').replace('_', ' ')}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Category</dt>
              <dd className="mt-0.5">
                <span className="chip border-accent/40 text-accent">
                  {result.category || 'Unclassified'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Sentiment</dt>
              <dd className="mt-0.5">
                <SentimentBadge sentiment={result.sentiment} score={result.sentiment_score} />
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">
            Routed to <span className="font-mono text-ink">{result.assigned_approver || '—'}</span>. A manager
            can now review the drafted replies in the Review Queue.
          </p>
        </div>
      )}
    </div>
  );
}
