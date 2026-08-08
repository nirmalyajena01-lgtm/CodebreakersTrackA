import { useState } from 'react';

export const REJECTION_REASONS = ['Too complex', 'Incorrect info', 'Too aggressive', 'Too vague', 'Other'];

export default function RejectFeedbackModal({ open, ticketId, submitting, onCancel, onSubmit }) {
  const [reason, setReason] = useState(REJECTION_REASONS[0]);
  const [freeText, setFreeText] = useState('');
  const [error, setError] = useState(null);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit(reason, freeText.trim() || null);
      setReason(REJECTION_REASONS[0]);
      setFreeText('');
    } catch (err) {
      setError(err.message || 'Rejection failed.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reject ticket and provide feedback"
    >
      <div className="card w-full max-w-md p-6 shadow-pop">
        <h3 className="font-serif text-lg font-semibold text-ink">Reject &amp; Provide Feedback</h3>
        <p className="mt-1 text-xs text-muted">
          Ticket <span className="font-mono">{ticketId}</span>. Your feedback is stored in swarm memory and the drafter
          will regenerate replies that avoid this mistake.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="reject-reason" className="label">
              Reason
            </label>
            <select
              id="reject-reason"
              className="field"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="reject-free-text" className="label">
              Additional feedback <span className="normal-case text-muted/70">(optional)</span>
            </label>
            <textarea
              id="reject-free-text"
              rows={4}
              className="field resize-y"
              placeholder="What should the drafts do differently?"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
            />
          </div>
          {error && (
            <div className="error-box">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-danger" disabled={submitting}>
              {submitting ? 'Re-drafting…' : 'Reject & Regenerate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
