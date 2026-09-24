import { useEffect, useMemo, useState } from 'react';
import { ShoppingCart, Info, Trash2, Loader2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { ItemPicker } from '../ims/imsUi.jsx';
import { BOQ_STAGE } from '../projects/orderTracking.jsx';
import { useProjects, useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useCreateRecord } from '../../app/api/recordsApi.js';

/**
 * Raise a purchase request — any doer, several items, one pass.
 *
 * WHAT IT FILES. A BOQ line IS a purchase order in this system (stage p13),
 * so raising a request is filing BOQ lines. Each item becomes its own line,
 * because quantity, category and vendor are all per-line: five items bought
 * together still need five rates and may need five vendors, and collapsing
 * them into one row would force that decision before anybody has made it.
 * From there the existing chain takes over unchanged — vendor finalization,
 * purchase order, tracking, GRN.
 *
 * WHY THE LINES ARE FILED AS DRAFTS. A submitted BOQ line must carry a rate
 * (the template marks it required, and the server enforces it on submit). The
 * person raising the request is saying WHAT is needed, not what it costs —
 * that is exactly the split between an indent and a priced BOQ. So the lines
 * land as drafts: they appear in the BOQ and on the Purchase Orders sheet
 * immediately, and the first thing anyone pricing them has to do is put a rate
 * on. Filing them as submitted would mean inventing a number.
 *
 * ITEMS COME FROM THE MASTER. The same `ItemPicker` the Stock in/out forms
 * use, so what can be requested is what actually exists, with its SKU — not a
 * typed name that no stock row will ever match.
 */

/** Only an exact option match is carried over — a near miss is a guess. */
const optionOrBlank = (value, options) => {
  if (!value) return '';
  const hit = (options || []).find((o) => String(o).toLowerCase() === String(value).toLowerCase());
  return hit || '';
};

export function RaisePurchaseModal({ open, onClose, projectId: initialProject = '' }) {
  const [projectId, setProjectId] = useState(initialProject);
  const [boqKey, setBoqKey] = useState('');
  const [why, setWhy] = useState('');
  const [lines, setLines] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: projectsResp, isLoading: projectsLoading } = useProjects({ limit: 200, sort: '-createdAt' });
  const projects = projectsResp?.data?.items || projectsResp?.data || projectsResp || [];

  const { data: project } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const templateStage = template?.stages?.find((s) => s.key === BOQ_STAGE);
  const schema = useMemo(() => templateStage?.masterDataSchema || [], [templateStage]);

  const fieldOptions = (key) => schema.find((f) => f.key === key)?.options || [];
  const boqOptions = fieldOptions('boq_type');

  const createRecord = useCreateRecord(projectId, BOQ_STAGE);

  /* Cleared on each opening — a request form that remembers the last one is a
     form that quietly raises it twice. */
  useEffect(() => {
    if (!open) return;
    setProjectId(initialProject);
    setBoqKey('');
    setWhy('');
    setLines([]);
    setError(null);
  }, [open, initialProject]);

  const chosen = useMemo(() => lines.map((l) => l.item?._id).filter(Boolean), [lines]);
  const addItem = (item) => setLines((prev) => [...prev, { item, qty: '' }]);
  const setQty = (i, v) => setLines((prev) => prev.map((l, k) => (k === i ? { ...l, qty: v } : l)));
  const dropLine = (i) => setLines((prev) => prev.filter((_, k) => k !== i));

  const ready = lines.filter((l) => l.item && l.qty !== '' && Number(l.qty) > 0);

  const raise = async () => {
    setError(null);
    if (!projectId) { setError('Pick the project this is for.'); return; }
    if (!ready.length) { setError('Add at least one item and a quantity.'); return; }

    setBusy(true);
    try {
      /* One at a time, and awaited: the seq each BOQ line is numbered with is
         read-then-written per record (record.service.js), so firing them in
         parallel is how two lines end up claiming one number. */
      for (const line of ready) {
        const values = {
          item: line.item.name,
          quantity: Number(line.qty),
          /* Only carried when the master's own value is one the BOQ offers —
             "IT Peripherals" is not "IT & Networking", and guessing it wrong
             puts the line in the wrong rate card. Left blank otherwise, which
             is a required field the pricer has to answer anyway. */
          category: optionOrBlank(line.item.category, fieldOptions('category')),
          unit: optionOrBlank(line.item.unit, fieldOptions('unit')),
          ...(boqKey ? { boq_type: boqKey } : {}),
          ...(why.trim() ? { description: why.trim() } : {}),
        };
        // eslint-disable-next-line no-await-in-loop
        await createRecord.mutateAsync({ values, status: 'draft' });
      }
      flashSuccess(ready.length === 1
        ? 'Request raised — it is on the BOQ, waiting on a rate'
        : `${ready.length} lines raised — they are on the BOQ, waiting on rates`);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not raise that.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Raise a purchase request"
      subtitle="Say what is needed and how much. Pricing and the vendor come after."
      width={720}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span className="tiny muted">
            {ready.length
              ? `${ready.length} line${ready.length === 1 ? '' : 's'} will be added to the BOQ as drafts`
              : 'Nothing to raise yet'}
          </span>
          <div className="row gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={raise} disabled={busy || !ready.length}>
              {busy
                ? <><Loader2 size={14} className="spin" /> Raising…</>
                : <><ShoppingCart size={14} /> Raise the request</>}
            </button>
          </div>
        </div>
      )}
    >
      <div className="col gap-3">
        {error && <div className="pcw-error">{error}</div>}

        <div className="pt-grid">
          <label className="pt-field">
            <span>Project *</span>
            <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select a project…</option>
              {projectsLoading && <option disabled>Loading…</option>}
              {(Array.isArray(projects) ? projects : []).map((p) => (
                <option key={p._id} value={p._id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>
              ))}
            </select>
          </label>

          {/* Optional: a line nobody files under a BOQ still shows, under the
              template's own "Not assigned to a BOQ" catch-all. */}
          <label className="pt-field">
            <span>BOQ</span>
            <select className="select" value={boqKey} onChange={(e) => setBoqKey(e.target.value)} disabled={!boqOptions.length}>
              <option value="">Decide later</option>
              {boqOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>

        <label className="pt-field">
          <span>Why it is needed</span>
          <textarea
            className="textarea"
            rows={2}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Optional — what it is for, any specification or size"
          />
        </label>

        <div className="col gap-2">
          <h3 className="inv-section-title">Items</h3>
          <ItemPicker
            onPick={addItem}
            exclude={chosen}
            placeholder="Search the item master by name or SKU, or click to browse…"
          />

          {!lines.length ? (
            <p className="inv-hint">
              <Info size={12} style={{ verticalAlign: -2 }} /> Nothing requested yet — search above,
              or click the box to see the item master. Each item becomes its own BOQ line, so every
              one can get its own rate and vendor.
            </p>
          ) : (
            <div className="ims-lines">
              {lines.map((l, i) => (
                <div key={l.item._id} className="ims-line">
                  <span className="ims-line-item">
                    <span className="ims-line-name" title={l.item.name}>{l.item.name}</span>
                    <span className="ims-line-meta">
                      {l.item.sku}
                      {l.item.category ? ` · ${l.item.category}` : ''}
                      {l.item.unit ? ` · ${l.item.unit}` : ''}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    step="1"
                    value={l.qty}
                    onChange={(e) => setQty(i, e.target.value)}
                    placeholder="qty"
                    aria-label={`Quantity for ${l.item.name}`}
                  />
                  <button type="button" className="ims-line-drop" onClick={() => dropLine(i)} title="Remove this line">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="inv-hint">
          <Info size={12} style={{ verticalAlign: -2 }} /> Raised lines land on the BOQ as drafts,
          because a BOQ line needs a rate before it can be submitted and a request is about what is
          needed, not what it costs. From there it is the usual road: vendor finalization → purchase
          order → tracking → GRN.
        </p>
      </div>
    </Modal>
  );
}

export default RaisePurchaseModal;
