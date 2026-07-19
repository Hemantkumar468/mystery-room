import { CheckCircle2 } from 'lucide-react';

/**
 * The single shared "Mark Done" trigger button for every phase page's stage-
 * completion flow — plain `.btn.btn-primary.btn-sm` (golden-gradient primary
 * button, hover lift, muted-disabled-text) with no per-page style overrides,
 * so every phase's button stays pixel-identical by construction instead of
 * by convention. Only opens the page's own confirm dialog; the actual
 * completion mutation/business logic stays with the caller.
 */
export function MarkDoneButton({ onClick, disabled, disabledTitle }) {
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm mark-done-btn"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
    >
      <CheckCircle2 size={14} /> Mark Done
    </button>
  );
}

export default MarkDoneButton;
