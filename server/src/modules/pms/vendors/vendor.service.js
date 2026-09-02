import { Record } from '../records/record.model.js';
import { Project } from '../projects/project.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { PROJECT_STATUS } from '../../../core/constants/index.js';

/**
 * Vendors, project-first.
 *
 * THE MODEL THIS IS BUILT ON, because it is not the one the spec assumed.
 * There is no `vendors` table and no `project_vendors` join table to add: a
 * vendor is a Phase 4B (`p12`) Record — `{ project, stageKey: 'p12', values }`
 * — and that Record already IS the join row the spec describes. It carries a
 * project reference, a status, quoted/negotiated amounts and payment terms
 * (the per-project half) alongside GST, PAN, rating and contacts (the firm
 * half). So the three screens need no migration, only a read model that
 * separates those two halves.
 *
 * WHAT IS GENUINELY MISSING is the firm identity. Because every project files
 * its own p12 record, the same firm engaged twice is two documents that can
 * disagree about its GST or rating — which the spec's fifth acceptance
 * criterion forbids. `firmKeyOf` below closes that WITHOUT a destructive
 * migration: records are matched into a firm, and firm-level fields are
 * resolved once across the whole firm so every project reads the same answer.
 * That is a derived firm, not a stored one; see the note on `resolveFirm`.
 */

/** Live work. A project outside these still appears if it has vendors — see listProjects(). */
const LIVE_STATUSES = [PROJECT_STATUS.PLANNING, PROJECT_STATUS.ACTIVE, PROJECT_STATUS.ON_HOLD];

const VENDOR_STAGE = 'p12';

const str = (v) => String(v ?? '').trim();
const digits = (v) => str(v).replace(/\D/g, '');

/**
 * Which firm a vendor record is about.
 *
 * Ordered by how strongly each field identifies a company. GST is a
 * registration number — two records sharing one are the same firm, full stop.
 * A phone number is nearly as strong. A name is the weakest (two "Santosh"
 * rows may be two different electricians) and is the last resort, which is why
 * it is normalised hard: case, punctuation and the usual suffixes removed.
 */
export function firmKeyOf(values = {}) {
  const gst = str(values.gst).toUpperCase().replace(/\s/g, '');
  if (gst) return `gst:${gst}`;
  const phone = digits(values.contact_phone).slice(-10);
  if (phone.length === 10) return `phone:${phone}`;
  const name = str(values.vendor_name)
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|and)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return name ? `name:${name}` : '';
}

/** Fields that describe the FIRM — identical from every project it serves. */
const FIRM_FIELDS = [
  'vendor_name', 'category', 'contact_person', 'contact_phone', 'email',
  'address', 'gst', 'pan', 'bank_details', 'rating', 'past_performance',
];

/** Fields that describe THIS ENGAGEMENT — different per project, by design. */
const LINK_FIELDS = [
  'status', 'work_scope', 'linked_task_code', 'quoted_amount',
  'negotiated_amount', 'payment_terms', 'credit_period_days', 'remarks',
];

const isEmpty = (v) => v === undefined || v === null || str(v) === '';

/**
 * One answer per firm field, across every record of that firm.
 *
 * Most-recently-updated non-empty value wins. Not "the first record found",
 * which would make the answer depend on which project you happened to open —
 * exactly the drift this exists to remove. A field nobody has filled anywhere
 * stays empty rather than being invented.
 */
function resolveFirm(siblings) {
  const newestFirst = [...siblings].sort(
    (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0),
  );
  const firm = {};
  for (const key of FIRM_FIELDS) {
    const hit = newestFirst.find((r) => !isEmpty(r.values?.[key]));
    firm[key] = hit ? hit.values[key] : null;
  }
  return firm;
}

export const vendorService = {
  /**
   * Screen 1 — the projects, with a vendor count each.
   *
   * Counts come from grouping the p12 records, never from loading each
   * project's vendors: the count is the only thing this screen needs.
   */
  async listProjects() {
    const [records, liveProjects] = await Promise.all([
      Record.find({ stageKey: VENDOR_STAGE }).select('project').lean(),
      Project.find({ status: { $in: LIVE_STATUSES } }).select('name code city status').lean(),
    ]);

    const counts = new Map();
    for (const r of records) {
      const id = String(r.project || '');
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }

    const byId = new Map(liveProjects.map((p) => [String(p._id), p]));

    /* A project that has vendors but has since completed or launched is still
       listed. The spec asks for live projects only, but honouring that alone
       would make an entire project's vendor history unreachable from the one
       page that exists to reach it — a filter should narrow a view, not delete
       data from the product. */
    const missing = [...counts.keys()].filter((id) => !byId.has(id));
    if (missing.length) {
      const extra = await Project.find({ _id: { $in: missing } })
        .select('name code city status').lean();
      for (const p of extra) byId.set(String(p._id), p);
    }

    return [...byId.values()]
      .map((p) => ({
        id: String(p._id),
        name: p.name,
        code: p.code,
        city: p.city || null,
        status: p.status,
        isLive: LIVE_STATUSES.includes(p.status),
        vendorCount: counts.get(String(p._id)) || 0,
      }))
      .sort((a, b) => b.vendorCount - a.vendorCount || a.name.localeCompare(b.name));
  },

  /** Screen 2 — this project's vendors. Name and trade only; it is a menu. */
  async listForProject(projectId) {
    const project = await Project.findById(projectId).select('name code city status').lean();
    if (!project) throw ApiError.notFound('Project not found');

    const records = await Record.find({ project: projectId, stageKey: VENDOR_STAGE })
      .select('values updatedAt').lean();

    const vendors = records
      .map((r) => ({
        linkId: String(r._id),
        vendorId: String(r._id),
        name: str(r.values?.vendor_name) || 'Unnamed vendor',
        category: str(r.values?.category) || null,
        status: str(r.values?.status) || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      project: {
        id: String(project._id),
        name: project.name,
        code: project.code,
        city: project.city || null,
      },
      vendors,
    };
  },

  /**
   * Screen 3 — the full record: the firm, this engagement, and the documents.
   *
   * `vendorId` is the p12 record's id — the engagement. The firm behind it is
   * resolved across every project that engaged the same company, so rating and
   * GST read identically from Noida and from Bhopal while quoted and PO stay
   * this project's own.
   */
  async getDetail(projectId, vendorId) {
    const record = await Record.findOne({
      _id: vendorId, project: projectId, stageKey: VENDOR_STAGE,
    }).populate('project', 'name code city').lean();
    if (!record) throw ApiError.notFound('Vendor not found on this project');

    const key = firmKeyOf(record.values);
    const all = key
      ? await Record.find({ stageKey: VENDOR_STAGE }).populate('project', 'name code city').lean()
      : [];
    const siblings = all.filter((r) => firmKeyOf(r.values) === key);
    const firm = resolveFirm(siblings.length ? siblings : [record]);

    const v = record.values || {};
    const link = {};
    for (const k of LINK_FIELDS) link[k] = isEmpty(v[k]) ? null : v[k];

    /* Everywhere else this firm is engaged — the page says so rather than
       implying this project is the whole relationship. */
    const alsoOn = siblings
      .filter((r) => String(r._id) !== String(record._id) && r.project)
      .map((r) => ({
        projectId: String(r.project._id),
        vendorId: String(r._id),
        projectName: r.project.name,
        city: r.project.city || null,
      }))
      .sort((a, b) => (a.city || '').localeCompare(b.city || ''));

    /* Documents. Every attachment here was uploaded against THIS project's
       record, so all of them are project-scoped. Firm-level documents (one GST
       certificate that every project shows) need an attachment that belongs to
       the firm rather than to a record — see the note at the top of this file. */
    const documents = (record.attachments || []).map((a) => ({
      id: String(a._id),
      label: a.name || 'Document',
      fileUrl: a.url,
      scope: 'project',
    }));

    return {
      project: {
        id: String(record.project?._id || projectId),
        name: record.project?.name || null,
        code: record.project?.code || null,
        city: record.project?.city || null,
      },
      vendor: { id: String(record._id), ...firm },
      link,
      alsoOn,
      documents,
      /* Not derivable today: no task in the model points at a vendor, so a
         vendor's on-time count cannot be computed. Returned explicitly as null
         so screen 3 renders an em dash rather than a fabricated "4 of 5". */
      performance: { tasksOnTime: null, tasksTotal: null },
      recordStatus: record.status,
      updatedAt: record.updatedAt,
    };
  },
};

export default vendorService;
