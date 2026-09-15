import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { DOCUMENTS } from '../../app/api/propertyCaptureApi.js';
import { usePropertyQuery } from './usePropertyQuery.js';
import { PropPager } from './PropPager.jsx';
import { PropTable } from './PropTable.jsx';
import {
  PropertyCell, ContactCell, PropertyToolbar, PageHead, PropEmpty,
  filesColumn,
} from './propertyUi.jsx';
import { PropertyMediaModal } from './PropertyMediaModal.jsx';

/**
 * Step 3 — Commercial Finalization.
 *
 * Six documents, one column each, and the cell IS the action: empty means not
 * started and opens a blank form, filled means it exists and opens what was
 * filed. The client asked for the columns to fill themselves in as the work is
 * done, and they do — every cell reads the real p3 record, so nothing here can
 * claim an LOI exists that nobody filed.
 *
 * `project_creation` is not one of the six. It is the handover after them, and
 * counting it would mean the bar never reached full until the project had
 * already started. The row says "ready for handover" instead once the six are
 * in, which is the fact somebody is actually waiting for.
 */
const state = (d) => {
  if (!d) return 'start';
  if (d.status === 'approved' || d.status === 'locked') return 'done';
  if (d.status === 'draft') return 'draft';
  return 'filed';
};

const LABEL = { start: 'Start', draft: 'Draft', filed: 'Filed', done: 'Done' };

/** What to say when the step is genuinely empty rather than just filtered. */
const EMPTY_HINT = 'Shortlist a property in Step 2, or skip assessment in Step 1.';

export default function PropertyCommercialPage() {
  const navigate = useNavigate();
  const q = usePropertyQuery('commercial');
  const [media, setMedia] = useState(null);

  /**
   * Open one document.
   *
   * A filed one opens its own record page, which is where the detail and the
   * PDF live. One that does not exist yet opens the Commercial Finalization
   * stage with that form selected — the same form the project has always used.
   */
  const openDoc = (row, type, doc) => {
    if (!row.projectId) return;
    navigate(doc?.id
      ? `/projects/${row.projectId}/commercial-finalization/record/${doc.id}`
      : `/projects/${row.projectId}/commercial-finalization?form=${type}`);
  };

  const columns = useMemo(() => [
    {
      key: 'action', label: 'Action', width: 248,
      render: (r) => {
        const filed = r.documentsFiled || 0;
        const complete = filed >= DOCUMENTS.length;
        return (
          <div className="prop-action-cell">
            <button
              type="button"
              className={`prop-action-btn${complete ? '' : ' is-quiet'}`}
              onClick={() => navigate(`/projects/${r.projectId}/commercial-finalization`)}
              title={complete
                ? 'All six documents are in — ready for project handover'
                : `${DOCUMENTS.length - filed} document(s) still outstanding`}
            >
              {complete ? 'Ready for handover' : 'Close it out'}
            </button>
            <button type="button" className="prop-open" onClick={() => navigate(`/projects/${r.projectId}`)}>
              Open ›
            </button>
          </div>
        );
      },
    },
    { key: 'title', label: 'Property', width: 225, sort: true, render: (r) => <PropertyCell row={r} /> },
    filesColumn(setMedia),
    { key: 'city', label: 'City', width: 98, sort: true, render: (r) => r.city || <span className="prop-dim">—</span> },

    ...DOCUMENTS.map((d) => ({
      key: d.key,
      label: d.label,
      width: 98,
      render: (r) => {
        const doc = (r.documents || []).find((x) => x.type === d.key);
        const s = state(doc);
        return (
          <button
            type="button"
            className={`prop-doc is-${s}`}
            onClick={() => openDoc(r, d.key, doc)}
            title={`${d.label} — ${LABEL[s]}`}
          >
            {s === 'done' && <Check size={11} />}
            {LABEL[s]}
          </button>
        );
      },
    })),

    {
      key: 'documents', label: 'Documents', width: 100, sort: true,
      render: (r) => {
        const filed = r.documentsFiled || 0;
        return (
          <>
            <div className="prop-progress" title={`${filed} of ${DOCUMENTS.length} filed`}>
              <span style={{ width: `${(filed / DOCUMENTS.length) * 100}%` }} />
            </div>
            <span className="prop-dim">{filed}/{DOCUMENTS.length}</span>
          </>
        );
      },
    },
    { key: 'submittedBy', label: 'Submitted by', width: 146, sort: true, render: (r) => <ContactCell row={r} /> },
    {
      key: 'project', label: 'Project', width: 158, sort: true,
      render: (r) => (r.projectName
        ? <button type="button" className="prop-link" onClick={() => navigate(`/projects/${r.projectId}`)}>{r.projectName}</button>
        : <span className="prop-dim">—</span>),
    },
  ], [navigate]);

  return (
    <>
      <PageHead
        title="Shortlisted properties closing"
        subtitle="Each cell opens its document — the columns fill as the work is filed."
      />
      <PropertyToolbar q={q} />

      {q.isLoading ? <PropEmpty title="Loading…" hint="One moment." />
        : q.isError ? <PropEmpty title="Could not load the queue" hint="The property service didn’t respond." />
          : q.rows.length === 0 ? (
            <PropEmpty
              title={q.active ? 'Nothing matches those filters' : 'Nothing here yet'}
              hint={q.active ? 'Clear the filters to see the whole step.' : EMPTY_HINT}
            />
          ) : (
            <>
              <PropTable
                columns={columns}
                rows={q.rows}
                rowKey={(r) => r.id}
                sort={q.sort}
                onSort={q.toggleSort}
                busy={q.isFetching}
              />
              <PropPager
                page={q.page}
                totalPages={q.totalPages}
                total={q.total}
                limit={q.limit}
                onPage={q.setPage}
                onLimit={q.setLimit}
              />
            </>
          )}

      {media && <PropertyMediaModal row={media} onClose={() => setMedia(null)} />}
    </>
  );
}
