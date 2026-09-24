/**
 * Presentational pieces of the property-intelligence report.
 *
 * Every one of these is a pure function of the report the server returned —
 * no fetching, no derivation of scores. The score arithmetic already happened
 * server-side (modules/ai/analysis/scoring.js) precisely so this layer can
 * stay dumb and the same numbers appear in the report, the properties table
 * and the comparison view without three implementations drifting apart.
 */

import { useState } from 'react';
import {
  ChevronDown, ExternalLink, Circle, MapPin, Building2, GraduationCap,
  Swords, TrainFront, Wallet, ListChecks, Quote, Info,
} from 'lucide-react';
import {
  bandMeta, decisionMeta, impactMeta, dataQualityMeta, scoreColor, toneColor,
  rentVerdictMeta, LIKELIHOOD_LABEL, RISK_CATEGORY_LABEL, ASSESSMENT_LABEL,
  AFFLUENCE_LABEL, sortRisks, sortByImpact, fmtDistance, hostOf,
} from './aiUi.js';

/* ─────────────────────── Hero score ─────────────────────── */

/**
 * The headline verdict. One number with no comparison to plot, so this is a
 * hero figure rather than a chart — the ring is a magnitude cue around it, not
 * a data series.
 */
export function ScoreHero({ score, result }) {
  const meta = bandMeta(score);
  const BandIcon = meta.icon;
  const value = score?.overall;

  const size = 132;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="ai-hero" style={{ '--ai-tone': meta.color }}>
      <div className="ai-hero-score">
        <svg width={size} height={size} role="img" aria-label={`Site score ${value ?? 'not scored'} out of 100`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={meta.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (pct / 100) * circumference}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        <div className="ai-hero-score-inner">
          <span className="ai-hero-value">{value ?? '—'}</span>
          <span className="ai-hero-outof">OUT OF 100</span>
        </div>
      </div>

      <div className="col gap-3" style={{ minWidth: 0 }}>
        <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
          {/* Icon + label alongside the tone — the verdict never rests on colour alone. */}
          <span className="ai-verdict-badge">
            <BandIcon size={15} /> {meta.label}
          </span>
          <ConfidenceChip score={score} />
          {score?.coverage != null && score.coverage < 100 && (
            <span className="ai-chip" style={{ '--ai-tone': toneColor('warning') }}>
              Partial — {score.coverage}% of rubric scored
            </span>
          )}
        </div>

        {result?.recommendation?.headline && (
          <div className="ai-headline">{result.recommendation.headline}</div>
        )}
        {result?.executive_summary && (
          <p className="ai-summary">{result.executive_summary}</p>
        )}
      </div>
    </div>
  );
}

function ConfidenceChip({ score }) {
  if (score?.confidence == null) return null;
  const tone = score.confidence >= 75 ? 'success' : score.confidence >= 50 ? 'info' : 'warning';
  return (
    <span
      className="ai-chip"
      style={{ '--ai-tone': toneColor(tone) }}
      title="How well-evidenced this report is — blended from the model's own confidence, the strength of evidence behind each pillar, and how many sources were found."
    >
      {score.confidenceLabel || 'Confidence'} confidence · {score.confidence}%
    </span>
  );
}

/* ─────────────────────── Pillar bars ─────────────────────── */

/**
 * Horizontal magnitude bars, one per rubric pillar, sorted worst-first so the
 * problems are read before the reassurance. Each row expands to the reasoning
 * and evidence behind its score.
 */
export function PillarBars({ pillars = [] }) {
  const [open, setOpen] = useState(null);
  if (!pillars.length) return null;

  const ordered = [...pillars].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));

  return (
    <div className="ai-pillars">
      {ordered.map((p) => {
        const isOpen = open === p.key;
        const tone = scoreColor(p.score);
        const dq = dataQualityMeta(p.dataQuality);

        return (
          <div key={p.key}>
            <button
              type="button"
              className="ai-pillar"
              style={{ '--ai-tone': tone }}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : p.key)}
            >
              <span className="ai-pillar-label">
                <ChevronDown
                  size={13}
                  className="muted"
                  style={{ transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', flexShrink: 0 }}
                />
                <span className="ai-pillar-name" title={p.label}>{p.label}</span>
                <span className="ai-pillar-weight" title={`This pillar is worth ${p.weight} of the 100 points`}>
                  {p.weight}
                </span>
              </span>

              <span className="ai-pillar-track-wrap">
                <span className="ai-pillar-track">
                  <span className="ai-pillar-fill" style={{ width: `${p.score ?? 0}%` }} />
                </span>
              </span>

              <span className="ai-pillar-value">
                <span className="ai-pillar-score">{p.score ?? '—'}</span>
                <span className="ai-pillar-points">
                  {p.points != null ? `· ${p.points}/${p.weight} pts` : ''}
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="ai-pillar-detail">
                {p.verdict && (
                  <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{p.verdict}</span>
                    <span className="ai-chip" style={{ '--ai-tone': dq.color }}>{dq.label}</span>
                  </div>
                )}
                {p.description && (
                  <div className="ai-pillar-rationale" style={{ fontStyle: 'italic', opacity: 0.85 }}>
                    {p.description}
                  </div>
                )}
                {p.rationale && <div className="ai-pillar-rationale">{p.rationale}</div>}
                {!!p.evidence?.length && (
                  <div>
                    <div className="ai-place-group-title" style={{ marginBottom: 5 }}>Evidence</div>
                    <ul className="ai-evidence-list">
                      {p.evidence.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────── Findings ─────────────────────── */

export function FindingGrid({ items = [], tone = 'info', emptyText }) {
  const sorted = sortByImpact(items);
  if (!sorted.length) return <div className="ai-suggest-basis">{emptyText || 'None recorded.'}</div>;

  return (
    <div className="ai-finding-grid">
      {sorted.map((f, i) => {
        const impact = impactMeta(f.impact);
        return (
          <div key={i} className="ai-finding" style={{ '--ai-tone': toneColor(tone) }}>
            <div className="ai-finding-head">
              <span className="ai-finding-title">{f.title}</span>
              <span className="ai-chip" style={{ '--ai-tone': impact.color }}>{impact.label}</span>
            </div>
            {f.detail && <div className="ai-finding-detail">{f.detail}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function RiskGrid({ risks = [] }) {
  const sorted = sortRisks(risks);
  if (!sorted.length) return <div className="ai-suggest-basis">No risks recorded.</div>;

  return (
    <div className="ai-finding-grid">
      {sorted.map((r, i) => {
        const impact = impactMeta(r.impact);
        return (
          <div key={i} className="ai-finding" style={{ '--ai-tone': impact.color }}>
            <div className="ai-finding-head">
              <span className="ai-finding-title">{r.title}</span>
              <span className="ai-chip" style={{ '--ai-tone': impact.color }}>{impact.label}</span>
            </div>
            <div className="row gap-2 wrap">
              {r.category && (
                <span className="ai-chip" style={{ '--ai-tone': 'var(--text-subtle)' }}>
                  {RISK_CATEGORY_LABEL[r.category] || r.category}
                </span>
              )}
              {r.likelihood && (
                <span className="ai-chip" style={{ '--ai-tone': 'var(--text-subtle)' }}>
                  {LIKELIHOOD_LABEL[r.likelihood] || r.likelihood}
                </span>
              )}
            </div>
            {r.detail && <div className="ai-finding-detail">{r.detail}</div>}
            {r.mitigation && (
              <div className="ai-mitigation"><b>Mitigation:</b> {r.mitigation}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────── Location profile ─────────────────────── */

function ProfileRow({ label, children }) {
  if (!children) return null;
  return (
    <div className="col gap-1" style={{ minWidth: 0 }}>
      <span className="tiny subtle upper" style={{ fontWeight: 700, letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>{children}</span>
    </div>
  );
}

export function LocationProfile({ profile }) {
  if (!profile) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
      <ProfileRow label="Resolved location">{profile.resolved_location}</ProfileRow>
      <ProfileRow label="Micro-market">{profile.micro_market}</ProfileRow>
      <ProfileRow label="Position within it">{profile.position_quality}</ProfileRow>
      <ProfileRow label="Catchment">{profile.catchment_summary}</ProfileRow>
      <ProfileRow label="Drawable population">{profile.estimated_catchment_population}</ProfileRow>
      <ProfileRow label="Age profile">{profile.dominant_age_profile}</ProfileRow>
      <ProfileRow label="Affluence band">
        {AFFLUENCE_LABEL[profile.affluence_band] || profile.affluence_band}
      </ProfileRow>
      <ProfileRow label="Weekday evening">{profile.weekday_evening_character}</ProfileRow>
      <ProfileRow label="Weekend">{profile.weekend_character}</ProfileRow>
    </div>
  );
}

/* ─────────────────────── Nearby places ─────────────────────── */

const PLACE_GROUPS = [
  { key: 'demand_sources', label: 'Group demand sources', icon: GraduationCap },
  { key: 'anchors', label: 'Trip-chaining anchors', icon: Building2 },
  { key: 'competitors', label: 'Competition', icon: Swords },
  { key: 'transport', label: 'Transport', icon: TrainFront },
];

export function NearbyPlaces({ nearby }) {
  if (!nearby) return null;
  const groups = PLACE_GROUPS.filter((g) => (nearby[g.key] || []).length);
  if (!groups.length) return <div className="ai-suggest-basis">No nearby places were established.</div>;

  return (
    <div className="ai-place-groups">
      {groups.map((g) => {
        const Icon = g.icon;
        // Nearest first — distance is the thing a reader scans for.
        const places = [...nearby[g.key]].sort(
          (a, b) => (Number(a.distance_km) || 99) - (Number(b.distance_km) || 99),
        );
        return (
          <div key={g.key}>
            <div className="ai-place-group-title"><Icon size={13} /> {g.label} ({places.length})</div>
            <div>
              {places.map((p, i) => (
                <div key={i} className="ai-place">
                  <div style={{ minWidth: 0 }}>
                    <div className="ai-place-name">{p.name}</div>
                    {p.type && <div className="ai-place-type">{p.type}</div>}
                    {p.note && <div className="ai-place-note">{p.note}</div>}
                  </div>
                  <span className="ai-place-distance">{fmtDistance(p.distance_km) || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────── Commercial read ─────────────────────── */

export function CommercialRead({ commercial }) {
  if (!commercial) return null;
  const verdict = rentVerdictMeta(commercial.rent_verdict);
  return (
    <div className="col gap-4">
      <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
        <Wallet size={14} className="muted" />
        <span style={{ fontSize: 12.5, fontWeight: 650 }}>Rent vs local benchmark</span>
        <span className="ai-chip" style={{ '--ai-tone': verdict.color }}>{verdict.label}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <ProfileRow label="Benchmark">{commercial.rent_benchmark_comment}</ProfileRow>
        <ProfileRow label="Rent to revenue">{commercial.rent_to_revenue_read}</ProfileRow>
        <ProfileRow label="Revenue potential">{commercial.revenue_potential_read}</ProfileRow>
        <ProfileRow label="Fit-out implication">{commercial.fitout_read}</ProfileRow>
      </div>
    </div>
  );
}

/* ─────────────────────── Recommendation ─────────────────────── */

export function RecommendationBlock({ recommendation, score }) {
  if (!recommendation) return null;
  const meta = decisionMeta(recommendation.decision);
  const DecisionIcon = meta.icon;

  return (
    <div className="col gap-4">
      <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
        <span className="ai-verdict-badge" style={{ '--ai-tone': meta.color }}>
          <DecisionIcon size={15} /> {meta.label}
        </span>
        {score?.bandAdvice && (
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{score.bandAdvice}</span>
        )}
      </div>

      {recommendation.rationale && <p className="ai-summary">{recommendation.rationale}</p>}

      {!!recommendation.deal_breakers?.length && (
        <div className="ai-finding" style={{ '--ai-tone': toneColor('danger') }}>
          <div className="ai-finding-title">Potential deal-breakers</div>
          <ul className="ai-evidence-list">
            {recommendation.deal_breakers.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      {!!recommendation.conditions?.length && (
        <div>
          <div className="ai-place-group-title">Conditions to satisfy first</div>
          <ul className="ai-evidence-list">
            {recommendation.conditions.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {!!recommendation.next_steps?.length && (
        <div>
          <div className="ai-place-group-title"><ListChecks size={13} /> Recommended next steps</div>
          <div className="ai-checklist">
            {recommendation.next_steps.map((s, i) => (
              <div key={i} className="ai-check-item"><Circle size={11} /> <span>{s}</span></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Suggested assessment inputs ─────────────────────── */

/**
 * Draft values for the Phase-2 assessment forms. Framed unmistakably as
 * suggestions for a human expert to accept or overrule — this module advises
 * the assessment, it does not replace the assessor.
 */
export function SuggestedInputs({ inputs = [] }) {
  if (!inputs.length) return <div className="ai-suggest-basis">No suggestions were produced.</div>;

  const grouped = inputs.reduce((acc, s) => {
    const key = s.assessment_type || 'other';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});

  return (
    <div className="col gap-5">
      <div className="ai-disclaimer">
        These are <b>starting points for the expert who owns each assessment</b>, derived from
        desk research only. Review, verify on site, and overrule anything the evidence does not
        support — nothing here is filled into a form automatically.
      </div>
      {Object.entries(grouped).map(([type, rows]) => (
        <div key={type}>
          <div className="ai-place-group-title">{ASSESSMENT_LABEL[type] || type} assessment</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="ai-suggest-table">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Field</th>
                  <th style={{ width: '20%' }}>Suggested</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={i}>
                    <td>{s.field_label}</td>
                    <td className="ai-suggest-value">{s.suggested_value}</td>
                    <td className="ai-suggest-basis">{s.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── Site visit questions ─────────────────────── */

export function SiteVisitQuestions({ questions = [] }) {
  if (!questions.length) return null;
  return (
    <div className="ai-checklist">
      {questions.map((q, i) => (
        <div key={i} className="ai-check-item"><MapPin size={12} /> <span>{q}</span></div>
      ))}
    </div>
  );
}

/* ─────────────────────── Confidence & gaps ─────────────────────── */

export function ConfidenceBlock({ score, confidence }) {
  if (!confidence && score?.confidence == null) return null;
  return (
    <div className="col gap-3">
      <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
        <Info size={14} className="muted" />
        <span style={{ fontSize: 12.5, fontWeight: 650 }}>
          {score?.confidenceLabel || '—'} confidence ({score?.confidence ?? '—'}%)
        </span>
      </div>
      {confidence?.rationale && <p className="ai-summary">{confidence.rationale}</p>}
      {!!confidence?.gaps?.length && (
        <div>
          <div className="ai-place-group-title">What would most improve this analysis</div>
          <ul className="ai-evidence-list">
            {confidence.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Sources ─────────────────────── */

export function SourceList({ citations = [] }) {
  if (!citations.length) {
    return (
      <div className="ai-suggest-basis">
        No web sources were captured for this run. Treat the findings as inference rather than
        verified fact.
      </div>
    );
  }
  return (
    <div className="ai-sources">
      {citations.map((c, i) => (
        <a
          key={i}
          className="ai-source"
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          title={c.title || c.url}
        >
          <Quote size={10} />
          <span className="ai-source-host">{hostOf(c.url)}</span>
          <ExternalLink size={10} />
        </a>
      ))}
    </div>
  );
}
