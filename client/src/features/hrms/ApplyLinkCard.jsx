/**
 * "Share the job" — the apply link, and the controls that decide whether it
 * still answers.
 *
 * Written for someone who is not technical and is in a hurry. Three questions,
 * in the order they are actually asked:
 *
 *   1. Is the link on right now?        → one line, one colour, at the top
 *   2. Give me the link                 → copy button
 *   3. Turn it off / set a closing time → the controls below
 *
 * The reason this exists: a link posted on LinkedIn keeps collecting
 * applications for weeks after HR has stopped reading them. People apply,
 * nobody replies, and the company looks like it does not care. So the link
 * gets an end date, and a switch that ends it right now.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link2, Copy, Check, Power, CalendarClock, X, ChevronDown, ChevronUp } from 'lucide-react';
import { SectionCard, Badge } from '../../components/ui/primitives.jsx';
import { DatePicker } from '../../components/ui/DatePicker.jsx';
import { fmtDateTimeLong } from '../../lib/format.js';
import { applyLinkFor } from './hrmsUi.js';

/* ── local-time ⇄ ISO, done by hand ──────────────────────────────────────
   Never `new Date('2026-09-09')` — that parses as UTC midnight, which is the
   previous evening in India, and a closing date would land a day early. Parts
   in, parts out, local throughout. */

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' + minutes-past-midnight → an ISO string for the server. */
function toIso(ymd, minutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Math.floor(minutes / 60), minutes % 60, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO (or Date) → { ymd, minutes } in the browser's own timezone. */
function fromIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return {
    ymd: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    minutes: d.getHours() * 60 + d.getMinutes(),
  };
}

/** N days from now, at the end of that day — what "close in a week" means. */
function daysFromNow(n, minutes = 23 * 60 + 59) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.toISOString();
}

/** Every half hour, labelled the way people say times out loud. */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const mins = i * 30;
  const h24 = Math.floor(mins / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { value: mins, label: `${h12}:${pad(mins % 60)} ${h24 < 12 ? 'AM' : 'PM'}` };
});
/* 11:59 PM rather than 11:30 PM, so "closes on the 9th" really does include
   all of the 9th. Appended because it is not on the half-hour grid. */
TIME_OPTIONS.push({ value: 23 * 60 + 59, label: '11:59 PM' });

const END_OF_DAY = 23 * 60 + 59;
const NINE_AM = 9 * 60;

/** Closed by the requisition's STATUS — nothing on this card can reopen it. */
const STATUS_HELD = new Set(['on_hold', 'filled', 'closed', 'not_found']);

/** Plain-language countdown. Nobody wants "in 172800000ms". */
function untilText(iso, now) {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'closed';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/* The same palette the requisition status badges use, so "Live" here reads as
   the same kind of green as "Open" in the page title. */
const TONE = {
  live: { color: '#059669', soft: '#DCFCE7' },
  pending: { color: '#D97706', soft: '#FEF3C7' },
  off: { color: '#6B7280', soft: '#F3F4F6' },
};

/** The status line: colour, word, and one sentence saying what it means. */
function statusOf(w, r, now) {
  if (!w) return { ...TONE.off, label: '—', line: '' };
  if (w.open) {
    return {
      ...TONE.live,
      label: 'Live',
      line: w.closesAt
        ? `Anyone with the link can apply. It stops ${untilText(w.closesAt, now)} — ${fmtDateTimeLong(w.closesAt)}.`
        : 'Anyone with the link can apply. There is no closing date, so it stays on until you turn it off.',
    };
  }
  const lines = {
    not_yet_open: `The link is not live yet. It switches on by itself on ${fmtDateTimeLong(w.opensAt)}.`,
    expired: `The closing time passed on ${fmtDateTimeLong(w.closesAt)}. Anyone opening the link now is told applications have closed.`,
    switched_off: 'You turned this link off. Anyone opening it is told applications have closed.',
    filled: 'All the openings are filled, so the link closed itself.',
    on_hold: 'This requisition is on hold, so the link is not answering.',
    closed: 'This requisition is closed, so the link is not answering.',
    not_found: 'This requisition is still a draft — the link will not open for anyone.',
  };
  const labels = {
    not_yet_open: 'Opens later', expired: 'Closed — time is up', switched_off: 'Turned off',
    filled: 'Filled', on_hold: 'On hold', closed: 'Closed', not_found: 'Draft',
  };
  return {
    ...(w.reason === 'not_yet_open' ? TONE.pending : TONE.off),
    label: labels[w.reason] || 'Closed',
    line: lines[w.reason] || 'The link is not accepting applications.',
  };
}

export function ApplyLinkCard({ r, canEdit, onChange, saving }) {
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);   // custom closing date/time open
  const [startOpen, setStartOpen] = useState(false); // the optional "opens at" row

  /* The card claims "closes in 2 hours". Left alone it would still claim that
     tomorrow, so the clock is re-read while the page is open — but only when
     there is a deadline to count down to. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!r?.applyClosesAt && !r?.applyOpensAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [r?.applyClosesAt, r?.applyOpensAt]);

  const link = applyLinkFor(r._id);
  const w = r.applyWindow;
  const s = useMemo(() => statusOf(w, r, now), [w, r, now]);

  const closeParts = fromIso(r.applyClosesAt);
  const openParts = fromIso(r.applyOpensAt);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the link is on screen to select by hand */ }
  };

  /* Every control below funnels through this, so there is exactly one place
     that writes the window and one place the parent has to authorise. */
  const save = (patch) => onChange(patch);

  const setClose = (ymd, minutes) => {
    const iso = toIso(ymd, minutes ?? closeParts?.minutes ?? END_OF_DAY);
    if (iso) save({ applyClosesAt: iso });
  };
  const setOpen = (ymd, minutes) => {
    const iso = toIso(ymd, minutes ?? openParts?.minutes ?? NINE_AM);
    if (iso) save({ applyOpensAt: iso });
  };

  const off = r.acceptingApplications === false;

  /* What the one big button should do right now. Order matters: the switch
     is checked first because it overrides the schedule, so a link that is
     both switched off AND past its date is reopened by turning it on — and
     the date is cleared at the same time, or it would shut again instantly. */
  const main = off
    ? {
      on: true,
      label: 'Start accepting applications again',
      patch: w?.reason === 'switched_off' && r.applyClosesAt && new Date(r.applyClosesAt) <= now
        ? { acceptingApplications: true, applyClosesAt: null }
        : { acceptingApplications: true },
      note: 'The link goes live again straight away, unless a date above says otherwise.',
    }
    : w?.reason === 'expired'
      ? {
        on: true,
        label: 'Reopen — remove the closing date',
        patch: { applyClosesAt: null },
        note: 'The closing time has already passed, so turning it back on means clearing that date. Set a new one afterwards if you want.',
      }
      : {
        on: false,
        label: 'Stop accepting applications now',
        patch: { acceptingApplications: false },
        note: 'Takes effect immediately. The link keeps working — it just tells people applications have closed.',
      };

  return (
    <SectionCard
      title="Share the job"
      subtitle="Anyone with the link can apply — no login"
      style={{ flex: '1 1 320px' }}
    >
      <div className="col gap-2">
        {/* 1 — is it on? */}
        <div className="alc-status" data-guide="apply-link-status">
          <Badge color={s.color} soft={s.soft} dot>{s.label}</Badge>
          <span className="tiny muted">{s.line}</span>
        </div>

        {/* 2 — the link */}
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <Link2 size={14} className="muted" />
          <span className="tiny mono truncate" style={{ flex: 1 }}>{link}</span>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={copy}>
          {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy apply link</>}
        </button>
        <span className="tiny muted">
          Paste it into WhatsApp, a job portal or a poster QR — applications land straight in the pipeline below.
        </span>

        {/* 3 — the controls */}
        {canEdit && (
          <div className="alc-controls">
            {/* A question, not a command — the same chips also RE-open a link
                that has already closed, and "stop taking applications" read
                as nonsense above them in that state. */}
            <div className="alc-label">When should it stop?</div>

            {/* Presets first: this is how the deadline actually gets set. */}
            <div className="alc-chips" data-guide="apply-link-schedule">
              <button type="button" className="alc-chip" disabled={saving}
                onClick={() => save({ applyClosesAt: daysFromNow(7) })}>In 1 week</button>
              <button type="button" className="alc-chip" disabled={saving}
                onClick={() => save({ applyClosesAt: daysFromNow(14) })}>In 2 weeks</button>
              <button type="button" className="alc-chip" disabled={saving}
                onClick={() => save({ applyClosesAt: daysFromNow(30) })}>In 1 month</button>
              <button type="button" className={`alc-chip${picking ? ' is-on' : ''}`}
                onClick={() => setPicking((v) => !v)}>
                <CalendarClock size={12} /> Pick date &amp; time
              </button>
              {r.applyClosesAt && (
                <button type="button" className="alc-chip alc-chip-clear" disabled={saving}
                  onClick={() => save({ applyClosesAt: null })}>
                  <X size={12} /> No end date
                </button>
              )}
            </div>

            {r.applyClosesAt && (
              <p className="alc-current">
                Closing on <strong>{fmtDateTimeLong(r.applyClosesAt)}</strong>
                {w?.open && w?.closesAt ? ` · ${untilText(w.closesAt, now)}` : ''}
              </p>
            )}

            {picking && (
              <div className="alc-pick">
                <label className="col gap-1" style={{ flex: '1 1 150px' }}>
                  <span className="label">Closing date</span>
                  <DatePicker
                    value={closeParts?.ymd || ''}
                    onChange={(ymd) => (ymd ? setClose(ymd) : save({ applyClosesAt: null }))}
                    placeholder="Choose a date"
                  />
                </label>
                <label className="col gap-1" style={{ flex: '0 1 130px' }}>
                  <span className="label">Time</span>
                  <select
                    className="input"
                    value={closeParts?.minutes ?? END_OF_DAY}
                    disabled={!closeParts}
                    onChange={(e) => setClose(closeParts.ymd, Number(e.target.value))}
                  >
                    {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
              </div>
            )}

            {/* The optional half. Most roles never need a start time, so it
                stays folded rather than doubling the controls on screen. */}
            <button type="button" className="alc-more" onClick={() => setStartOpen((v) => !v)}>
              {startOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {r.applyOpensAt
                ? `Starts ${fmtDateTimeLong(r.applyOpensAt)}`
                : 'Start it later instead of right now'}
            </button>

            {startOpen && (
              <div className="alc-pick">
                <label className="col gap-1" style={{ flex: '1 1 150px' }}>
                  <span className="label">Opening date</span>
                  <DatePicker
                    value={openParts?.ymd || ''}
                    onChange={(ymd) => (ymd ? setOpen(ymd) : save({ applyOpensAt: null }))}
                    placeholder="Choose a date"
                  />
                </label>
                <label className="col gap-1" style={{ flex: '0 1 130px' }}>
                  <span className="label">Time</span>
                  <select
                    className="input"
                    value={openParts?.minutes ?? NINE_AM}
                    disabled={!openParts}
                    onChange={(e) => setOpen(openParts.ymd, Number(e.target.value))}
                  >
                    {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                {r.applyOpensAt && (
                  <button type="button" className="alc-chip alc-chip-clear" disabled={saving}
                    onClick={() => save({ applyOpensAt: null })}>
                    <X size={12} /> Start immediately
                  </button>
                )}
              </div>
            )}

            {/* One button, and it is always the thing worth doing NEXT.
                Offering "stop accepting applications" on a link that closed
                two days ago is the kind of dead control that teaches people
                the screen is not telling them the truth. */}
            <button
              type="button"
              data-guide="apply-link-kill"
              className={`btn btn-sm alc-kill${main.on ? ' is-off' : ''}`}
              disabled={saving}
              onClick={() => save(main.patch)}
            >
              <Power size={13} />
              {main.label}
            </button>
            <span className="tiny muted">{main.note}</span>

            {/* When the STATUS is what is holding the link shut, neither the
                switch nor a date will reopen it, and saying so beats letting
                someone press buttons that cannot work. */}
            {STATUS_HELD.has(w?.reason) && (
              <span className="tiny muted">
                This link stays shut while the requisition is
                {w.reason === 'filled' ? ' marked Filled' : w.reason === 'on_hold' ? ' On hold' : ' Closed'}
                {' '}— change that at the top of the page to bring it back.
              </span>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export default ApplyLinkCard;
