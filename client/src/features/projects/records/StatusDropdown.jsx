import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { Badge } from '../../../components/ui/primitives.jsx';
import { cardStatusMeta, STATUS_DROPDOWN_OPTIONS } from './recordUi.js';
import { RejectDialog } from './RejectDialog.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';

/**
 * Enterprise inline-editable Status cell — replaces the old read-only Badge
 * + separate Approve/Reject action buttons with a single control, the same
 * "click the status pill to change it" pattern SAP/Oracle Fusion/Dynamics/
 * ServiceNow tables use.
 *
 * Read-only (no `canDecide`) renders exactly the same Badge as before —
 * regular users never see it as clickable. Editable users get a button that
 * opens a small menu of the seven statuses; selecting Rejected requires a
 * reason (Comments optional) via RejectDialog, selecting Approved requires
 * confirmation via ConfirmDialog, everything else applies immediately.
 * `onDecide(record, verb, extra)` is the one thing a caller needs to wire —
 * it should call the page's existing `useRecordDecision` mutation, whose
 * cache invalidation already refreshes the table without a full reload and
 * whose server-side handler already writes the Activity Timeline / audit
 * trail entry — nothing extra to do here for those requirements.
 *
 * The menu itself is portaled to `document.body` and positioned from the
 * trigger's own viewport rect — every RecordsTable lives inside a
 * horizontally-scrolling wrapper (`overflow-x: auto`), which per the CSS
 * overflow spec forces the vertical axis to `auto` too, clipping any
 * absolutely-positioned child that isn't a portal.
 */
export function StatusDropdown({ record, canDecide, onDecide, pending }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const meta = cardStatusMeta(record);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (e.target.closest?.('.status-dropdown-menu')) return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (!canDecide) {
    return <Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge>;
  }

  const choose = (option) => {
    setOpen(false);
    if (option.value === 'rejected') { setRejecting(true); return; }
    if (option.value === 'approved') { setConfirmingApprove(true); return; }
    onDecide(record, option.verb);
  };

  return (
    <div className="status-dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="status-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
      >
        <Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge>
        <ChevronDown size={12} className="status-dropdown-caret" />
      </button>

      {open && menuPos && createPortal(
        <div className="status-dropdown-menu" role="menu" style={{ top: menuPos.top, left: menuPos.left }}>
          {STATUS_DROPDOWN_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              className="status-dropdown-item"
              onClick={() => choose(option)}
            >
              <span className="status-dropdown-dot" style={{ background: option.color }} />
              <span className="status-dropdown-label">{option.label}</span>
              {record?.status === option.value && <Check size={13} className="status-dropdown-check" />}
            </button>
          ))}
        </div>,
        document.body,
      )}

      <RejectDialog
        open={rejecting}
        title={`Reject ${record?.title || 'Record'}`}
        onClose={() => setRejecting(false)}
        onConfirm={(reason, remarks) => {
          onDecide(record, 'reject', { reason, remarks });
          setRejecting(false);
        }}
        pending={pending}
        placeholder="Why is this record being rejected?"
      />

      <ConfirmDialog
        open={confirmingApprove}
        title="Approve record"
        message={`Approve "${record?.title || 'this record'}"? This marks it as officially signed off.`}
        confirmLabel="Approve"
        onClose={() => setConfirmingApprove(false)}
        onConfirm={() => {
          onDecide(record, 'approve');
          setConfirmingApprove(false);
        }}
        pending={pending}
      />
    </div>
  );
}

export default StatusDropdown;
