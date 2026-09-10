import { Truck, Check, Package, Boxes, TriangleAlert, CircleDashed } from 'lucide-react';

/**
 * One receipt status, rendered the same everywhere.
 *
 * Keyed on the EXACT status strings factsOf() produces (orderTracking.jsx) —
 * the tone and the icon are looked up, never derived from the text, so a new
 * status shows as neutral rather than silently picking up whichever colour a
 * substring match happened to hit.
 */
const LOOK = {
  Dispatched: { tone: 'gold', Icon: Truck },
  Delivered: { tone: 'warn', Icon: Package },
  'Partly Received': { tone: 'warn', Icon: Boxes },
  'Received (GRN)': { tone: 'ok', Icon: Check },
  'Short / Damaged': { tone: 'bad', Icon: TriangleAlert },
  Ordered: { tone: 'gold', Icon: CircleDashed },
  Cancelled: { tone: 'mute', Icon: CircleDashed },
};

export function ReceiptStatusBadge({ status }) {
  const { tone, Icon } = LOOK[status] || { tone: 'mute', Icon: CircleDashed };
  return (
    <span className={`gr-badge t-${tone}`}>
      <Icon size={14} strokeWidth={2.4} />
      {status}
    </span>
  );
}

export default ReceiptStatusBadge;
