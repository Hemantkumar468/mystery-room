import { useEffect, useMemo, useState } from 'react';
import {
  MessageCircle, RefreshCw, Trash2, Send, ShieldCheck, ShieldAlert,
  AlertTriangle, Link2, ScrollText, Settings2, LayoutList, Plus,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState, ErrorState, Spinner } from '../../components/ui/primitives.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import {
  useGetWhatsappSettingsQuery, useUpdateWhatsappSettingsMutation, useVerifyWhatsappQuery,
  useGetWhatsappTemplatesQuery, useSyncWhatsappTemplatesMutation, useCreateWhatsappTemplateMutation,
  useUpdateWhatsappTemplateMutation, useDeleteWhatsappTemplateMutation,
  useGetWhatsappEventMapsQuery, useSaveWhatsappEventMapMutation, useDeleteWhatsappEventMapMutation,
  useGetWhatsappLogsQuery, useGetWhatsappLogSummaryQuery,
  useRefreshWhatsappLogStatusMutation, useTestSendWhatsappMutation,
} from '../../app/api/whatsappApi.js';
import { WhatsappTemplateComposer } from './WhatsappTemplateComposer.jsx';

/**
 * The WhatsApp channel, on one page with four tabs.
 *
 * WHAT THIS PAGE IS FOR. WhatsApp will only deliver an approved TEMPLATE to
 * somebody who has not messaged the business in the last 24 hours — which is
 * every doer, every time a task is assigned at night. So the channel is not
 * "type a message and send it": it is a mapping from an ERP event to a
 * template Meta has already approved, and this page is where that mapping is
 * made and checked.
 *
 * HOW TEMPLATES GET HERE. Two ways. Sync mirrors whatever SmartWhap already
 * has, with its real approval status. The composer writes a new one, checks it
 * against every rule Meta rejects on, and submits it — and because the
 * SmartWhap API has no create route deployed, it keeps the result as a DRAFT
 * with the exact text to paste into their dashboard. A draft is never sendable;
 * it becomes APPROVED only when the provider says so at the next sync.
 *
 * THE ONE THING TO REMEMBER when reading this screen: a send reports "sent"
 * whether or not WhatsApp delivered it. Only the Logs tab tells the truth.
 *
 * Managers run the channel; anything destructive is the MD's, and the server
 * enforces that regardless of what renders here.
 */

const EVENT_LABELS = {
  TASK_ASSIGNED: 'Task assigned',
  TASK_REMINDER: 'Task reminder (before due date)',
  TASK_OVERDUE: 'Task overdue',
  TASK_COMPLETED: 'Task completed (to manager)',
};

const PARAM_SOURCES = [
  { value: 'recipient.name', label: "Recipient's name" },
  { value: 'task.title', label: 'Task title' },
  { value: 'task.phase', label: 'Phase' },
  { value: 'task.property', label: 'Property' },
  { value: 'task.project', label: 'Project' },
  { value: 'task.dueDate', label: 'Due date' },
  { value: 'task.status', label: 'Task status' },
  { value: 'task.url', label: 'Task link' },
  { value: 'task.completedBy', label: 'Completed by' },
  { value: 'task.completedOn', label: 'Completed on' },
  { value: 'alert.text', label: 'Alert text ("2 days" / "overdue by 3 days")' },
  { value: 'custom', label: 'Fixed text…' },
];

const SAMPLE = {
  'recipient.name': 'Vikram',
  'task.title': 'Vendor Identification',
  'task.phase': 'Phase 2 - Site Evaluation',
  'task.property': 'Wave One, Sector 18 Noida',
  'task.project': 'Mystery Rooms Noida',
  'task.dueDate': '05 Sep 2026',
  'task.status': 'In Progress',
  'task.url': 'https://erp.mysteryrooms.in/task/1042',
  'task.completedBy': 'Vikram',
  'task.completedOn': '04 Sep 2026',
  'alert.text': '2 days',
};

const STATUS_COLOR = {
  delivered: '#16A34A',
  read: '#0EA5E9',
  sent: '#D97706',
  queued: '#6B7280',
  failed: '#DC2626',
  skipped: '#6B7280',
};

const CATEGORY_COLOR = { UTILITY: '#16A34A', AUTHENTICATION: '#0EA5E9', MARKETING: '#D97706' };

/** Approval state, at a glance. DRAFT is ours — composed here but not yet on
 *  SmartWhap; PENDING is Meta still deciding. */
const STATUS_BADGE = {
  APPROVED: '#16A34A',
  PENDING: '#D97706',
  DRAFT: '#6366F1',
  REJECTED: '#DC2626',
  PAUSED: '#DC2626',
  REMOVED: '#6B7280',
};

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** axiosBaseQuery normalises every failure to { status, code, message } —
 *  there is no `.data` wrapper to read through. */
const errText = (e) => e?.message || e?.data?.message || 'Something went wrong';

/** Reads pass this so a failure renders inside the tab instead of raising a
 *  toast. Four reads on one screen would otherwise stack four identical
 *  toasts the moment the server is unreachable. */
const SILENT = { silentError: true };

/* ── Tab 1: templates ───────────────────────────────────────── */

function TemplatesTab({ isMd }) {
  const { data: templates = [], isLoading, isError, error: loadError, refetch } = useGetWhatsappTemplatesQuery(SILENT);
  const [sync, syncState] = useSyncWhatsappTemplatesMutation();
  const [updateTemplate] = useUpdateWhatsappTemplateMutation();
  const [deleteTemplate] = useDeleteWhatsappTemplateMutation();
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);

  const run = async (fn) => {
    setError('');
    try { await fn().unwrap(); } catch (e) { setError(errText(e)); }
  };

  const usable = templates.filter((t) => t.status === 'APPROVED' && t.category !== 'MARKETING').length;
  const drafts = templates.filter((t) => t.status === 'DRAFT').length;

  return (
    <div className="col gap-4">
      <div className="row gap-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}>
          <Plus size={14} /> New template
        </button>
        <button type="button" className="btn btn-ghost" disabled={syncState.isLoading}
          onClick={() => run(() => sync())}>
          <RefreshCw size={14} /> {syncState.isLoading ? 'Syncing…' : 'Sync from SmartWhap'}
        </button>
        <span className="sm muted">
          {templates.length} template{templates.length === 1 ? '' : 's'} · {usable} usable for notifications
          {drafts > 0 && ` · ${drafts} draft${drafts === 1 ? '' : 's'} to create in the dashboard`}
        </span>
      </div>

      {composing && <WhatsappTemplateComposer onClose={() => setComposing(false)} />}

      {/* Said here rather than in a doc nobody opens: the first question this
          screen gets is "where is the Create button". */}
      <div className="card sm" style={{ padding: 12, display: 'flex', gap: 10 }}>
        <Link2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          New templates are created in the <strong>SmartWhap dashboard</strong>, not here — their API has no
          create endpoint. Make one there, then press Sync. Notifications need the <strong>UTILITY</strong> category;
          Meta throttles MARKETING templates and they will not arrive.
        </div>
      </div>

      {error && <div className="card sm" style={{ padding: 12, color: 'var(--danger)' }}>{error}</div>}

      {isLoading ? <Spinner label="Loading templates" />
        : isError ? (
          <ErrorState
            title="Could not load templates"
            hint={`${errText(loadError)}${loadError?.status === 404 ? ' — the server is running an older build. Restart it to pick up the WhatsApp routes.' : ''}`}
            onRetry={refetch}
          />
        ) : templates.length === 0 ? (
          <EmptyState icon={MessageCircle} title="No templates yet"
            hint="Press Sync to pull the approved templates from SmartWhap." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table sm">
              <thead>
                <tr>
                  <th>Name</th><th>Category</th><th>Lang</th><th>Vars</th><th>Status</th>
                  <th>Description</th><th>Active</th>{isMd && <th />}
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t._id}>
                    <td><code>{t.name}</code></td>
                    <td>
                      <Badge soft color={CATEGORY_COLOR[t.category] || '#6B7280'}>{t.category}</Badge>
                      {t.category === 'MARKETING' && (
                        <span className="sm muted" style={{ display: 'block', marginTop: 2 }}>
                          <AlertTriangle size={11} /> throttled by Meta
                        </span>
                      )}
                    </td>
                    <td className="sm">{t.language}</td>
                    <td className="sm">{t.variableCount}</td>
                    <td>
                      <Badge soft color={STATUS_BADGE[t.status] || '#6B7280'}>{t.status}</Badge>
                      {t.status === 'DRAFT' && (
                        <span className="sm muted" style={{ display: 'block', marginTop: 2 }}>
                          create it in the dashboard, then Sync
                        </span>
                      )}
                      {t.status === 'PENDING' && (
                        <span className="sm muted" style={{ display: 'block', marginTop: 2 }}>
                          waiting on Meta
                        </span>
                      )}
                    </td>
                    <td>
                      <input className="input sm" defaultValue={t.description || ''} placeholder="What it is for"
                        onBlur={(e) => {
                          if (e.target.value !== (t.description || '')) {
                            run(() => updateTemplate({ id: t._id, description: e.target.value }));
                          }
                        }} />
                    </td>
                    <td>
                      <input type="checkbox" checked={t.isActive !== false}
                        onChange={(e) => run(() => updateTemplate({ id: t._id, isActive: e.target.checked }))} />
                    </td>
                    {isMd && (
                      <td>
                        <button type="button" className="btn btn-ghost btn-icon" title="Remove from the list"
                          onClick={() => {
                            if (window.confirm(`Remove "${t.name}" from this list? It stays on SmartWhap.`)) {
                              run(() => deleteTemplate(t._id));
                            }
                          }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

/* ── Tab 2: event mapping ───────────────────────────────────── */

function EventRow({ map, templates, isMd, onError }) {
  const [save, saveState] = useSaveWhatsappEventMapMutation();
  const [remove] = useDeleteWhatsappEventMapMutation();

  const [templateName, setTemplateName] = useState(map.templateName || '');
  const [language, setLanguage] = useState(map.language || 'en');
  const [bindings, setBindings] = useState(map.paramMapping || []);
  const [recipientRule, setRecipientRule] = useState(map.recipientRule || 'assignee');
  const [leadTimeDays, setLeadTimeDays] = useState(map.leadTimeDays ?? 1);
  const [isEnabled, setIsEnabled] = useState(Boolean(map.isEnabled));
  const [saved, setSaved] = useState(false);

  const template = templates.find((t) => t.name === templateName && t.language === language);

  // Re-shape the bindings whenever the chosen template changes: a mapping for
  // a 3-variable template is meaningless against a 6-variable one, and the
  // server rejects a mismatch anyway.
  useEffect(() => {
    if (!template) return;
    setBindings((prev) => Array.from({ length: template.variableCount }, (_, i) => (
      prev.find((b) => b.position === i + 1) || { position: i + 1, source: 'recipient.name', value: '' }
    )));
  }, [template?.name, template?.language, template?.variableCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => {
    if (!template) return '';
    return String(template.bodyPreview || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
      const b = bindings.find((x) => x.position === Number(n));
      if (!b) return `{{${n}}}`;
      return b.source === 'custom' ? (b.value || '…') : (SAMPLE[b.source] ?? `{{${n}}}`);
    });
  }, [template, bindings]);

  const submit = async () => {
    onError('');
    setSaved(false);
    try {
      await save({
        eventKey: map.eventKey, templateName, language,
        paramMapping: bindings.map((b) => ({
          position: b.position, source: b.source, ...(b.source === 'custom' ? { value: b.value || '' } : {}),
        })),
        recipientRule, isEnabled, leadTimeDays: Number(leadTimeDays),
      }).unwrap();
      setSaved(true);
    } catch (e) {
      onError(errText(e));
    }
  };

  const isScheduled = map.eventKey === 'TASK_REMINDER';

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row gap-3" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <strong>{EVENT_LABELS[map.eventKey] || map.eventKey}</strong>
          <div className="sm muted"><code>{map.eventKey}</code></div>
        </div>
        <label className="row gap-2 sm" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>

      <div className="row gap-3" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <label className="col gap-1 sm">
          Template
          <select className="input sm" value={`${templateName}::${language}`}
            onChange={(e) => {
              const [n, l] = e.target.value.split('::');
              setTemplateName(n); setLanguage(l);
            }}>
            <option value="::en">— choose —</option>
            {templates.map((t) => (
              <option key={t._id} value={`${t.name}::${t.language}`}>
                {t.name} ({t.language}, {t.variableCount} vars)
              </option>
            ))}
          </select>
        </label>

        <label className="col gap-1 sm">
          Send to
          <select className="input sm" value={recipientRule} onChange={(e) => setRecipientRule(e.target.value)}>
            <option value="assignee">The assignee</option>
            <option value="manager">Their manager</option>
            <option value="md">The MD</option>
            <option value="actor">Whoever triggered it</option>
          </select>
        </label>

        {isScheduled && (
          <label className="col gap-1 sm">
            Days before due
            <input className="input sm" type="number" min="0" max="30" style={{ width: 90 }}
              value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
          </label>
        )}
      </div>

      {template && (
        <div className="col gap-2" style={{ marginTop: 14 }}>
          <div className="sm muted">
            This template needs <strong>{template.variableCount}</strong> value{template.variableCount === 1 ? '' : 's'}.
            Bind each one to a field from the task.
          </div>

          {bindings.map((b) => (
            <div key={b.position} className="row gap-2" style={{ alignItems: 'center' }}>
              <code className="sm" style={{ width: 42 }}>{`{{${b.position}}}`}</code>
              <select className="input sm" value={b.source}
                onChange={(e) => setBindings((prev) => prev.map((x) => (
                  x.position === b.position ? { ...x, source: e.target.value } : x
                )))}>
                {PARAM_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              {b.source === 'custom' && (
                <input className="input sm" placeholder="Fixed text" value={b.value || ''}
                  onChange={(e) => setBindings((prev) => prev.map((x) => (
                    x.position === b.position ? { ...x, value: e.target.value } : x
                  )))} />
              )}
            </div>
          ))}

          {/* The preview is the whole point of this form: a wrong binding is
              invisible in a list of positions and obvious in a sentence. */}
          <div className="card sm" style={{ padding: 12, whiteSpace: 'pre-wrap', background: 'var(--surface-2)' }}>
            {preview || 'No preview available'}
          </div>
        </div>
      )}

      <div className="row gap-2" style={{ marginTop: 14, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary sm" disabled={!templateName || saveState.isLoading}
          onClick={submit}>
          {saveState.isLoading ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="sm" style={{ color: 'var(--success, #16A34A)' }}>Saved</span>}
        {isMd && map._id && (
          <button type="button" className="btn btn-ghost sm" onClick={() => {
            if (window.confirm(`Remove the mapping for ${map.eventKey}?`)) remove(map._id);
          }}>
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

function EventMapTab({ isMd }) {
  const { data: maps = [], isLoading, isError, error: loadError, refetch } = useGetWhatsappEventMapsQuery(SILENT);
  const { data: templates = [] } = useGetWhatsappTemplatesQuery(SILENT);
  const [error, setError] = useState('');

  // Only what can actually be sent: approved, not marketing, not retired.
  const usable = templates.filter(
    (t) => t.status === 'APPROVED' && t.category !== 'MARKETING' && t.isActive !== false,
  );

  if (isLoading) return <Spinner label="Loading mappings" />;
  if (isError) {
    return <ErrorState title="Could not load event mappings" hint={errText(loadError)} onRetry={refetch} />;
  }

  return (
    <div className="col gap-4">
      {usable.length === 0 && (
        <div className="card sm" style={{ padding: 12, display: 'flex', gap: 10 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            No usable templates yet. Create <strong>UTILITY</strong> templates in the SmartWhap dashboard,
            get them approved, then Sync on the Templates tab.
          </div>
        </div>
      )}

      {error && <div className="card sm" style={{ padding: 12, color: 'var(--danger)' }}>{error}</div>}

      {maps.map((m) => (
        <EventRow key={m.eventKey} map={m} templates={usable} isMd={isMd} onError={setError} />
      ))}
    </div>
  );
}

/* ── Tab 3: delivery logs ───────────────────────────────────── */

function LogsTab() {
  const [filters, setFilters] = useState({ status: '', eventKey: '', page: 1, limit: 25 });
  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
  const { data, isLoading, isFetching, isError, error: loadError, refetch } = useGetWhatsappLogsQuery({ ...query, ...SILENT });
  const { data: summary } = useGetWhatsappLogSummaryQuery(SILENT);
  const [refresh, refreshState] = useRefreshWhatsappLogStatusMutation();

  const items = data?.items || [];

  return (
    <div className="col gap-4">
      <div className="row gap-3" style={{ flexWrap: 'wrap' }}>
        {['delivered', 'sent', 'failed', 'skipped'].map((k) => (
          <div key={k} className="card" style={{ padding: '10px 16px', minWidth: 110 }}>
            <div className="sm muted" style={{ textTransform: 'capitalize' }}>{k} today</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: STATUS_COLOR[k] }}>{summary?.[k] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Stated on the screen where people will look for it, because the
          send response says "sent" for messages WhatsApp never delivered. */}
      <div className="sm muted">
        <strong>sent</strong> means the provider accepted it — not that it arrived.
        Only <strong>delivered</strong> means it reached the phone.
      </div>

      <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
        <select className="input sm" value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}>
          <option value="">All statuses</option>
          {['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input sm" value={filters.eventKey}
          onChange={(e) => setFilters((f) => ({ ...f, eventKey: e.target.value, page: 1 }))}>
          <option value="">All events</option>
          {Object.keys(EVENT_LABELS).map((k) => <option key={k} value={k}>{EVENT_LABELS[k]}</option>)}
          <option value="TEST">Test sends</option>
        </select>
        {isFetching && <span className="sm muted">Refreshing…</span>}
      </div>

      {isLoading ? <Spinner label="Loading logs" />
        : isError ? (
          <ErrorState title="Could not load delivery logs" hint={errText(loadError)} onRetry={refetch} />
        ) : items.length === 0 ? (
          <EmptyState icon={ScrollText} title="Nothing sent yet"
            hint="Messages appear here as soon as the first one goes out." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table sm">
              <thead>
                <tr><th>When</th><th>Event</th><th>Template</th><th>To</th><th>Status</th><th>Reason</th><th /></tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <tr key={log._id}>
                    <td className="sm">{fmt(log.createdAt)}</td>
                    <td className="sm">{EVENT_LABELS[log.eventKey] || log.eventKey}</td>
                    <td className="sm"><code>{log.templateName}</code></td>
                    <td className="sm">
                      {log.recipient?.name || log.phone}
                      {log.redirected && <Badge soft color="#D97706">test mode</Badge>}
                    </td>
                    <td><Badge soft color={STATUS_COLOR[log.status] || '#6B7280'}>{log.status}</Badge></td>
                    <td className="sm muted" style={{ maxWidth: 320 }}>{log.statusMessage || '—'}</td>
                    <td>
                      {log.chatMessageId && (
                        <button type="button" className="btn btn-ghost btn-icon" title="Check status now"
                          disabled={refreshState.isLoading} onClick={() => refresh(log._id)}>
                          <RefreshCw size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {data && data.pages > 1 && (
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost sm" disabled={filters.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Previous</button>
          <span className="sm muted">Page {data.page} of {data.pages}</span>
          <button type="button" className="btn btn-ghost sm" disabled={filters.page >= data.pages}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</button>
        </div>
      )}
    </div>
  );
}

/* ── Tab 4: settings + test send ────────────────────────────── */

function SettingsTab({ isMd }) {
  const { data: settings, isLoading, isError, error: loadError, refetch } = useGetWhatsappSettingsQuery(SILENT);
  const { data: verified } = useVerifyWhatsappQuery(SILENT);
  const [update, updateState] = useUpdateWhatsappSettingsMutation();
  const { data: templates = [] } = useGetWhatsappTemplatesQuery(SILENT);
  const [testSend, testState] = useTestSendWhatsappMutation();

  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState({ phone: '', templateName: '', language: 'en', params: [] });
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (settings && !form) {
      setForm({
        isEnabled: settings.isEnabled,
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
        maxMessagesPerUserPerDay: settings.maxMessagesPerUserPerDay,
        escalateAfterDays: settings.escalateAfterDays,
        taskLinkBaseUrl: settings.taskLinkBaseUrl || '',
      });
    }
  }, [settings, form]);

  const testTemplate = templates.find((t) => t.name === test.templateName && t.language === test.language);

  const save = async () => {
    setError(''); setSaved(false);
    try {
      await update({
        ...form,
        quietHoursStart: Number(form.quietHoursStart),
        quietHoursEnd: Number(form.quietHoursEnd),
        maxMessagesPerUserPerDay: Number(form.maxMessagesPerUserPerDay),
        escalateAfterDays: Number(form.escalateAfterDays),
      }).unwrap();
      setSaved(true);
    } catch (e) { setError(errText(e)); }
  };

  const runTest = async () => {
    setError(''); setTestResult(null);
    try {
      const res = await testSend({
        phone: test.phone, templateName: test.templateName, language: test.language,
        params: (test.params || []).map((p) => String(p ?? '')),
      }).unwrap();
      setTestResult(res);
    } catch (e) { setError(errText(e)); }
  };

  if (isError) {
    return (
      <ErrorState
        title="Could not load settings"
        hint={`${errText(loadError)}${loadError?.status === 404 ? ' — the server is running an older build. Restart it to pick up the WhatsApp routes.' : ''}`}
        onRetry={refetch}
      />
    );
  }
  if (isLoading || !form) return <Spinner label="Loading settings" />;

  const env = settings.env || {};

  return (
    <div className="col gap-4">
      {/* Connection first: an admin who has switched everything on and sees
          nothing sent needs the reason on the same screen. */}
      <div className="card" style={{ padding: 16 }}>
        <h3 className="row gap-2" style={{ alignItems: 'center', marginTop: 0 }}>
          {verified?.ok ? <ShieldCheck size={16} color="#16A34A" /> : <ShieldAlert size={16} color="#DC2626" />}
          Connection
        </h3>
        <table className="table sm">
          <tbody>
            <tr><td>Provider</td><td>{env.baseUrl}</td></tr>
            <tr><td>Token</td><td><code>{verified?.token || '— not set —'}</code></td></tr>
            <tr>
              <td>Credentials</td>
              <td>
                {verified?.ok
                  ? <Badge soft color="#16A34A">working{verified.scopeLimited ? ' (limited scope)' : ''}</Badge>
                  : <Badge soft color="#DC2626">{verified?.reason || 'not verified'}</Badge>}
              </td>
            </tr>
            <tr>
              <td>Server switch</td>
              <td>{env.configured
                ? (env.enabled ? <Badge soft color="#16A34A">on</Badge> : <Badge soft color="#DC2626">WHATSAPP_ENABLED=false</Badge>)
                : <Badge soft color="#DC2626">no token on the server</Badge>}
              </td>
            </tr>
            {env.testMode && (
              <tr>
                <td>Test mode</td>
                <td><Badge soft color="#D97706">every message goes to {env.testNumber}</Badge></td>
              </tr>
            )}
            <tr><td>Templates last synced</td><td>{fmt(settings.lastSyncedAt)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Rules</h3>

        <label className="row gap-2" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={form.isEnabled} disabled={!isMd}
            onChange={(e) => { setForm((f) => ({ ...f, isEnabled: e.target.checked })); setSaved(false); }} />
          <span><strong>Send WhatsApp notifications</strong> — the master switch for this company</span>
        </label>

        <div className="row gap-4" style={{ marginTop: 14, flexWrap: 'wrap' }}>
          <label className="col gap-1 sm">
            Quiet hours from
            <input className="input sm" type="number" min="0" max="23" style={{ width: 90 }} disabled={!isMd}
              value={form.quietHoursStart} onChange={(e) => setForm((f) => ({ ...f, quietHoursStart: e.target.value }))} />
          </label>
          <label className="col gap-1 sm">
            until
            <input className="input sm" type="number" min="0" max="23" style={{ width: 90 }} disabled={!isMd}
              value={form.quietHoursEnd} onChange={(e) => setForm((f) => ({ ...f, quietHoursEnd: e.target.value }))} />
          </label>
          <label className="col gap-1 sm">
            Max messages per person per day
            <input className="input sm" type="number" min="1" max="50" style={{ width: 110 }} disabled={!isMd}
              value={form.maxMessagesPerUserPerDay}
              onChange={(e) => setForm((f) => ({ ...f, maxMessagesPerUserPerDay: e.target.value }))} />
          </label>
          <label className="col gap-1 sm">
            Escalate to manager after (days overdue)
            <input className="input sm" type="number" min="1" max="30" style={{ width: 110 }} disabled={!isMd}
              value={form.escalateAfterDays}
              onChange={(e) => setForm((f) => ({ ...f, escalateAfterDays: e.target.value }))} />
          </label>
        </div>

        <label className="col gap-1 sm" style={{ marginTop: 14 }}>
          Task link base URL
          <input className="input" placeholder="https://erp.mysteryrooms.in" disabled={!isMd}
            value={form.taskLinkBaseUrl} onChange={(e) => setForm((f) => ({ ...f, taskLinkBaseUrl: e.target.value }))} />
          <span className="muted">
            Used to build the link in a message. Kept here rather than inside the template, so changing the
            domain never needs Meta's approval again.
          </span>
        </label>

        <p className="sm muted" style={{ marginTop: 12 }}>
          Quiet hours hold a message until morning rather than dropping it. The daily cap is what keeps people
          from blocking the business number — and a blocked number eventually stops delivering to everyone.
        </p>

        {isMd ? (
          <div className="row gap-2" style={{ marginTop: 12, alignItems: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={updateState.isLoading}>
              {updateState.isLoading ? 'Saving…' : 'Save settings'}
            </button>
            {saved && <span className="sm" style={{ color: '#16A34A' }}>Saved</span>}
          </div>
        ) : (
          <p className="sm muted" style={{ marginTop: 12 }}>Only the MD can change these.</p>
        )}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <h3 className="row gap-2" style={{ alignItems: 'center', marginTop: 0 }}><Send size={16} /> Send a test</h3>
        <p className="sm muted">
          Sends one real message. Set <code>WHATSAPP_TEST_NUMBER</code> on the server to route every send to a
          test handset instead of a colleague's phone.
        </p>

        <div className="row gap-3" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="col gap-1 sm">
            Phone
            <input className="input sm" placeholder="9876543210" value={test.phone}
              onChange={(e) => setTest((t) => ({ ...t, phone: e.target.value }))} />
          </label>
          <label className="col gap-1 sm">
            Template
            <select className="input sm" value={`${test.templateName}::${test.language}`}
              onChange={(e) => {
                const [n, l] = e.target.value.split('::');
                const tpl = templates.find((x) => x.name === n && x.language === l);
                setTest((t) => ({ ...t, templateName: n, language: l, params: Array(tpl?.variableCount || 0).fill('') }));
              }}>
              <option value="::en">— choose —</option>
              {templates.filter((t) => t.status === 'APPROVED').map((t) => (
                <option key={t._id} value={`${t.name}::${t.language}`}>
                  {t.name} ({t.language}, {t.variableCount} vars)
                </option>
              ))}
            </select>
          </label>
        </div>

        {testTemplate && testTemplate.variableCount > 0 && (
          <div className="col gap-2" style={{ marginTop: 12 }}>
            {Array.from({ length: testTemplate.variableCount }, (_, i) => (
              <div key={i} className="row gap-2" style={{ alignItems: 'center' }}>
                <code className="sm" style={{ width: 42 }}>{`{{${i + 1}}}`}</code>
                <input className="input sm" value={test.params[i] || ''}
                  onChange={(e) => setTest((t) => {
                    const params = [...t.params];
                    params[i] = e.target.value;
                    return { ...t, params };
                  })} />
              </div>
            ))}
          </div>
        )}

        <button type="button" className="btn btn-primary sm" style={{ marginTop: 12 }}
          disabled={!test.phone || !test.templateName || testState.isLoading} onClick={runTest}>
          {testState.isLoading ? 'Sending…' : 'Send test'}
        </button>

        {testResult && (
          <div className="card sm" style={{ padding: 12, marginTop: 12 }}>
            <Badge soft color={STATUS_COLOR[testResult.log?.status] || '#6B7280'}>{testResult.log?.status}</Badge>
            <div style={{ marginTop: 6 }}>{testResult.note}</div>
            {testResult.log?.statusMessage && (
              <div className="sm muted" style={{ marginTop: 4 }}>{testResult.log.statusMessage}</div>
            )}
            <div className="sm muted" style={{ marginTop: 4 }}>Check the Logs tab for the delivered/failed outcome.</div>
          </div>
        )}
      </div>

      {error && <div className="card sm" style={{ padding: 12, color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────── */

export function WhatsappSettingsPage() {
  const user = useAppSelector(selectCurrentUser);
  const isMd = can.administer(user?.role);
  const [tab, setTab] = useState('templates');

  const TABS = [
    { key: 'templates', label: 'Templates', icon: LayoutList },
    { key: 'events', label: 'Event mapping', icon: MessageCircle },
    { key: 'logs', label: 'Delivery logs', icon: ScrollText },
    { key: 'settings', label: 'Settings', icon: Settings2 },
  ];

  return (
    <>
      <Topbar title="WhatsApp notifications" />

      <div className="content col gap-4">
        <div className="tabs" role="tablist" aria-label="WhatsApp settings sections">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'templates' && <TemplatesTab isMd={isMd} />}
        {tab === 'events' && <EventMapTab isMd={isMd} />}
        {tab === 'logs' && <LogsTab />}
        {tab === 'settings' && <SettingsTab isMd={isMd} />}
      </div>
    </>
  );
}

export default WhatsappSettingsPage;
