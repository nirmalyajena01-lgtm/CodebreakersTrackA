import { useState } from 'react';

const STYLE_META = {
  formal: { label: 'Formal' },
  empathetic: { label: 'Empathetic' },
  concise: { label: 'Concise' },
};

function ComplianceChip({ score, passed }) {
  if (score == null) {
    return <span className="chip text-muted">compliance n/a</span>;
  }
  const ok = score >= 80 && passed !== false;
  return (
    <span
      className={`chip ${
        ok
          ? 'border-olive/50 text-olive'
          : 'border-brick/50 text-brick'
      }`}
      title={passed === false ? 'Below policy threshold (80)' : 'Passes policy threshold (80)'}
    >
      compliance {score}
    </span>
  );
}

export default function DraftCard({ draft, selected, onSelect, disabled }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STYLE_META[draft.style] || { label: draft.style };

  return (
    <div
      className={`card card-hover relative flex flex-col p-4 ${
        selected ? 'border-accent/60 ring-1 ring-accent/25' : ''
      }`}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="radio"
          name="draft-select"
          className="mt-1 h-4 w-4 shrink-0 accent-accent"
          checked={selected}
          disabled={disabled}
          onChange={() => onSelect && onSelect(draft.style)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-serif text-sm font-semibold capitalize text-ink">
              {meta.label}
            </span>
            <ComplianceChip score={draft.compliance_score} passed={draft.compliance_passed} />
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{draft.text}</p>
        </div>
      </label>

      {draft.thought_process && (
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-deep"
          >
            <svg
              className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
            Drafter thought process
          </button>
          {expanded && (
            <p className="mt-2 rounded-lg border border-border bg-paper p-3 text-xs leading-relaxed text-muted">
              {draft.thought_process}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
