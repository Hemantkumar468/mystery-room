/**
 * The AI score as a single table cell.
 *
 * Used in the Property Identification table so a reviewer can see which
 * candidates the AI rates highly before opening any of them. Compact by
 * necessity — the full reasoning lives on the property's detail page, and this
 * cell exists only to point there.
 *
 * Colour is paired with the number and a tooltip carrying the verdict label, so
 * the cell still reads correctly in greyscale or under colour-vision
 * deficiency — a bare coloured dot would not.
 */

import { Sparkles } from 'lucide-react';
import { bandMeta, scoreColor } from './aiUi.js';

export function AiScoreCell({ score }) {
  if (!score || score.overall == null) {
    return <span className="tiny muted">—</span>;
  }

  const meta = bandMeta(score);
  const title = [
    `${score.overall}/100 — ${meta.label}`,
    score.confidence != null ? `${score.confidence}% confidence` : null,
    score.headline || null,
    score.isStale ? 'This report is over a week old.' : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <span
      className="ai-score-cell"
      style={{ '--ai-tone': scoreColor(score.overall) }}
      title={title}
    >
      <span className="ai-score-dot" />
      <span className="ai-score-num">{score.overall}</span>
      {score.isStale && (
        <Sparkles size={10} className="muted" aria-label="Analysis may be out of date" />
      )}
    </span>
  );
}

export default AiScoreCell;
