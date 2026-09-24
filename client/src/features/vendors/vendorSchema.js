import { useMemo } from 'react';
import { useTemplates } from '../../app/api/templatesApi.js';

/**
 * The p12 form definition, from the published client-flow template — the same
 * schema every project's Phase 4B uses, so the vendor pages and the phase can
 * never disagree about what a vendor is.
 *
 * Lifted out of VendorsPage when the drill-down arrived: three screens and the
 * onboarding flow all need it, and a second copy of this lookup is a second
 * thing to forget when the template changes.
 */
export function useVendorSchema() {
  const { data: tplResp } = useTemplates({ status: 'published', limit: 50 });
  const templates = tplResp?.data || tplResp || [];
  return useMemo(() => {
    for (const t of templates) {
      const stage = (t.stages || []).find((s) => s.key === 'p12');
      if (stage?.masterDataSchema?.length) return stage.masterDataSchema;
    }
    return [];
  }, [templates]);
}

/** Fields that describe the FIRM, not this engagement. Mirrors vendor.service.js. */
export const FIRM_FIELDS = [
  'vendor_name', 'category', 'contact_person', 'contact_phone', 'email',
  'address', 'gst', 'pan', 'bank_details', 'rating', 'past_performance',
];

/** Status colours, shared by every screen that shows a vendor's status. */
export const STATUS_TONE = {
  Identified: { soft: 'var(--surface-2)' },
  'Quotation Received': { color: 'var(--primary)', soft: 'var(--primary-soft, var(--surface-2))' },
  'Under Comparison': { color: 'var(--warning)', soft: 'var(--warning-soft)' },
  Finalised: { color: 'var(--success)', soft: 'var(--success-soft)' },
  Rejected: { color: 'var(--danger)', soft: 'var(--danger-soft, #FEE2E2)' },
  Blacklisted: { color: '#fff', soft: 'var(--danger)' },
};

export default useVendorSchema;
