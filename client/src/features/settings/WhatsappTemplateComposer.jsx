import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Copy, GripVertical, Check } from 'lucide-react';
import { Badge } from '../../components/ui/primitives.jsx';
import { useCreateWhatsappTemplateMutation } from '../../app/api/whatsappApi.js';

/**
 * Write a WhatsApp template, with the variables draggable rather than typed.
 *
 * WHY IT VALIDATES SO HARD. Meta rejects a template hours after submission, in
 * a notice attached to nothing anybody remembers writing. Every rule it
 * enforces is checked here, live, next to the text — a rejected template is a
 * day lost waiting for an answer that could have been given immediately.
 *
 * WHY A DRAFT IS A REAL OUTCOME. SmartWhap has no create endpoint, so the
 * server keeps the composed template as a DRAFT and this screen hands over the
 * exact text to paste into their dashboard. The alternative — refusing to let
 * anyone compose at all — means doing the same work in a textarea with no
 * validation and no preview.
 *
 * The drop target is a plain textarea: dropping inserts `{{n}}` at the caret
 * and seeds that placeholder's sample value. Typing `{{1}}` by hand works
 * exactly the same; dragging is a shortcut, never the only path.
 */

const STATUS_BADGE = {
  APPROVED: '#16A34A',
  PENDING: '#D97706',
  DRAFT: '#6366F1',
  REJECTED: '#DC2626',
  PAUSED: '#DC2626',
  REMOVED: '#6B7280',
};

/** The fields a template variable can stand for, offered as draggable chips. */
export const DRAG_FIELDS = [
  { label: 'Recipient name', sample: 'Vikram' },
  { label: 'Task title', sample: 'Vendor Identification' },
  { label: 'Phase', sample: 'Phase 2 - Site Evaluation' },
  { label: 'Property', sample: 'Wave One, Sector 18 Noida' },
  { label: 'Project', sample: 'Mystery Rooms Noida' },
  { label: 'Due date', sample: '05 Sep 2026' },
  { label: 'Task status', sample: 'In Progress' },
  { label: 'Task link', sample: 'https://erp.mysteryrooms.in/task/1042' },
  { label: 'Alert text', sample: 'overdue by 3 days' },
  { label: 'Completed by', sample: 'Vikram' },
];

const errText = (e) => e?.message || e?.data?.message || 'Something went wrong';

export function WhatsappTemplateComposer({ onClose }) {
  const [create, createState] = useCreateWhatsappTemplateMutation();
  const bodyRef = useRef(null);

  const [form, setForm] = useState({
    name: '', category: 'UTILITY', language: 'en', body: '', footer: 'Mystery Rooms PMS', description: '',
  });
  const [samples, setSamples] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setError(''); };

  const placeholders = form.body.match(/\{\{\s*\d+\s*\}\}/g) || [];
  const count = placeholders.length;

  // Keep the sample list the same length as the placeholders: deleting {{2}}
  // from the text must not leave its example behind to be submitted.
  useEffect(() => {
    setSamples((prev) => Array.from({ length: count }, (_, i) => prev[i] || ''));
  }, [count]);

  /** Every rule Meta would reject on, evaluated as you type. */
  const problems = useMemo(() => {
    const list = [];
    const body = form.body.trim();

    if (form.name && !/^[a-z0-9_]+$/.test(form.name)) {
      list.push('Name may only contain lowercase letters, numbers and underscores');
    }
    if (body) {
      const nums = placeholders.map((p) => Number(p.replace(/[^\d]/g, '')));
      const expected = nums.map((_, i) => i + 1);
      if ([...nums].sort((a, b) => a - b).join(',') !== expected.join(',')) {
        list.push(`Placeholders must run 1..${nums.length} with no gaps or repeats`);
      }
      if (/^\s*\{\{/.test(body)) list.push('A placeholder cannot open the message — put text before it');
      if (/\}\}\s*$/.test(body)) list.push('A placeholder cannot end the message — put text after it');
      if (/\}\}\s*\{\{/.test(body)) list.push('Two placeholders cannot sit next to each other');
      if (body.length > 1024) list.push('The body must be 1024 characters or fewer');
    }
    if (count && samples.some((v) => !v.trim())) list.push('Every placeholder needs a sample value');
    if (form.category === 'MARKETING') {
      list.push('MARKETING templates are throttled by Meta and will not arrive — use UTILITY');
    }
    return list;
  }, [form, placeholders, samples, count]);

  const canSubmit = Boolean(form.name) && Boolean(form.body.trim()) && problems.length === 0 && !createState.isLoading;

  /** Insert `{{n}}` at the caret, and seed that placeholder's sample value. */
  const insertField = (field, at) => {
    const el = bodyRef.current;
    const pos = at ?? el?.selectionStart ?? form.body.length;
    const next = count + 1;
    const token = `{{${next}}}`;

    setForm((f) => ({ ...f, body: `${f.body.slice(0, pos)}${token}${f.body.slice(pos)}` }));
    setSamples((prev) => {
      const copy = [...prev];
      copy[next - 1] = field.sample;
      return copy;
    });

    // Caret lands after what was just inserted, so typing continues where the
    // eye already is.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const p = pos + token.length;
      el.setSelectionRange(p, p);
    });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const label = e.dataTransfer.getData('text/plain');
    const field = DRAG_FIELDS.find((f) => f.label === label);
    if (field) insertField(field);
  };

  const preview = form.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => samples[Number(n) - 1] || `{{${n}}}`);

  const dashboardText = [
    `Name: ${form.name}`,
    `Category: ${form.category}`,
    `Language: ${form.language}`,
    '',
    form.body,
    '',
    form.footer ? `Footer: ${form.footer}` : '',
    samples.length ? `Sample values: ${samples.join(' | ')}` : '',
  ].filter(Boolean).join('\n');

  const submit = async () => {
    setError('');
    try {
      const res = await create({
        name: form.name.trim().toLowerCase(),
        category: form.category,
        language: form.language,
        body: form.body.trim(),
        bodySampleValues: samples,
        ...(form.footer ? { footer: form.footer } : {}),
        ...(form.description ? { description: form.description } : {}),
      }).unwrap();
      setResult(res);
    } catch (e) {
      setError(errText(e));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dashboardText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically — select the text above and copy it by hand.');
    }
  };

  /* ── After submitting ───────────────────────────────────── */
  if (result) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <Badge soft color={STATUS_BADGE[result.template?.status] || '#6B7280'}>{result.template?.status}</Badge>
          <strong>{result.template?.name}</strong>
        </div>
        <p style={{ marginTop: 8 }}>{result.note}</p>

        {!result.submitted && (
          <>
            {/* A draft is only useful if it can be moved into the dashboard
                without retyping it, so the exact text goes on the clipboard. */}
            <pre className="card sm" style={{ padding: 12, whiteSpace: 'pre-wrap', marginTop: 8 }}>{dashboardText}</pre>
            <button type="button" className="btn btn-ghost sm" onClick={copy}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy for the SmartWhap dashboard</>}
            </button>
          </>
        )}

        <div className="row gap-2" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary sm" onClick={onClose}>Done</button>
        </div>
      </div>
    );
  }

  /* ── The form ───────────────────────────────────────────── */
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>New template</h3>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="row gap-3" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <label className="col gap-1 sm">
          Name
          <input className="input sm" placeholder="pms_task_assigned" value={form.name}
            onChange={(e) => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
        </label>
        <label className="col gap-1 sm">
          Category
          <select className="input sm" value={form.category} onChange={(e) => set('category', e.target.value)}>
            <option value="UTILITY">UTILITY — task, reminder, alert</option>
            <option value="AUTHENTICATION">AUTHENTICATION — OTP only</option>
            <option value="MARKETING">MARKETING — throttled, avoid</option>
          </select>
        </label>
        <label className="col gap-1 sm">
          Language
          <select className="input sm" value={form.language} onChange={(e) => set('language', e.target.value)}>
            <option value="en">en</option>
            <option value="en_US">en_US</option>
            <option value="hi">hi</option>
          </select>
        </label>
      </div>

      <div className="col gap-2" style={{ marginTop: 14 }}>
        <div className="sm muted">Drag a field into the message, or click it to insert at the cursor.</div>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {DRAG_FIELDS.map((f) => (
            <button
              key={f.label}
              type="button"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', f.label)}
              onClick={() => insertField(f)}
              className="btn btn-ghost sm"
              style={{ cursor: 'grab', gap: 4 }}
              title={`Example: ${f.sample}`}
            >
              <GripVertical size={12} /> {f.label}
            </button>
          ))}
        </div>
      </div>

      <label className="col gap-1 sm" style={{ marginTop: 14 }}>
        Message
        <textarea
          ref={bodyRef}
          className="input"
          rows={7}
          style={{ fontFamily: 'inherit', outline: dragOver ? '2px dashed var(--primary)' : 'none' }}
          placeholder={'Hi {{1}}, task "{{2}}" has been assigned to you. Due: {{3}}.\n\nPlease update the status in ERP.'}
          value={form.body}
          onChange={(e) => set('body', e.target.value)}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
        />
        <span className="muted">{form.body.length}/1024 · {count} variable{count === 1 ? '' : 's'}</span>
      </label>

      {count > 0 && (
        <div className="col gap-2" style={{ marginTop: 10 }}>
          <div className="sm muted">Sample values — Meta reviews the template using these.</div>
          {samples.map((v, i) => (
            <div key={i} className="row gap-2" style={{ alignItems: 'center' }}>
              <code className="sm" style={{ width: 42 }}>{`{{${i + 1}}}`}</code>
              <input className="input sm" value={v}
                onChange={(e) => setSamples((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
          ))}
        </div>
      )}

      <div className="row gap-3" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <label className="col gap-1 sm" style={{ flex: 1, minWidth: 200 }}>
          Footer (optional)
          <input className="input sm" maxLength={60} value={form.footer} onChange={(e) => set('footer', e.target.value)} />
        </label>
        <label className="col gap-1 sm" style={{ flex: 1, minWidth: 200 }}>
          What it is for (internal note)
          <input className="input sm" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </label>
      </div>

      {form.body && (
        <div className="col gap-1" style={{ marginTop: 14 }}>
          <div className="sm muted">Preview — what the doer sees</div>
          <div className="card sm" style={{ padding: 12, whiteSpace: 'pre-wrap', background: 'var(--surface-2)' }}>
            {preview}
            {form.footer && <div className="sm muted" style={{ marginTop: 8 }}>{form.footer}</div>}
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="sm" style={{ marginTop: 12, color: 'var(--danger)' }}>
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {error && <div className="card sm" style={{ padding: 12, marginTop: 10, color: 'var(--danger)' }}>{error}</div>}

      <div className="row gap-2" style={{ marginTop: 14 }}>
        <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
          {createState.isLoading ? 'Saving…' : 'Create template'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default WhatsappTemplateComposer;
