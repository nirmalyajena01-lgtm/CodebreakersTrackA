// Sentiment heatmap badge.
// score >= 7  -> brick (angry / urgent)
// 4 <= score < 7 -> ochre
// score < 4   -> olive (calm / happy)

export function heatForScore(score) {
  if (score == null) {
    return { key: 'unknown', classes: 'border-border bg-tint text-muted', dot: 'bg-muted' };
  }
  if (score >= 7) {
    return { key: 'hot', classes: 'border-brick/50 bg-tint text-brick', dot: 'bg-brick' };
  }
  if (score >= 4) {
    return { key: 'warm', classes: 'border-ochre/50 bg-tint text-ochre', dot: 'bg-ochre' };
  }
  return { key: 'cool', classes: 'border-olive/50 bg-tint text-olive', dot: 'bg-olive' };
}

export default function SentimentBadge({ sentiment, score, showScore = true }) {
  const heat = heatForScore(score);
  return (
    <span className={`chip ${heat.classes}`} title={`Sentiment score: ${score ?? 'n/a'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${heat.dot}`} />
      <span>{sentiment || 'Unknown'}</span>
      {showScore && score != null && <span className="opacity-80">· {Number(score).toFixed(1)}</span>}
    </span>
  );
}
