import { PackageCheck, FileBox, TriangleAlert, FileText, RotateCcw, WalletCards } from 'lucide-react';
import { inr } from '../../projects/orderTracking.jsx';
import { StatCard } from './StatCard.jsx';

/**
 * The six numbers, in the order the work happens: what was booked in, what
 * is still owed, what came wrong, what has been billed, what is waiting to
 * be billed, and what the lot is worth.
 */
export function GoodsReceivedStats({ k }) {
  return (
    <section className="gr-stats" aria-label="Goods received summary">
      <StatCard icon={PackageCheck} tone="ok" label="GRNs recorded" value={k.grns} hint="Total GRNs in system" />
      <StatCard icon={FileBox} tone="warn" label="Partly received" value={k.partial} hint="Awaiting balance quantity" />
      <StatCard icon={TriangleAlert} tone="bad" label="Short / damaged" value={k.short} hint="Items with issues" />
      <StatCard icon={FileText} tone="info" label="Invoiced" value={k.invoiced} hint="GRNs with invoice" />
      <StatCard icon={RotateCcw} tone="warn" label="GRN, no invoice yet" value={k.toInvoice} hint="Pending invoicing" />
      <StatCard icon={WalletCards} tone="gold" money label="Value received (qty × rate)" value={inr(k.receivedValue)} hint="Total received value" />
    </section>
  );
}

export default GoodsReceivedStats;
