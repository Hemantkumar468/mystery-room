import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { useGoBack } from '../../components/layout/BackButton.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { DailySiteReports } from './DailySiteReports.jsx';

/**
 * The daily site reports on their OWN url — /projects/:id/daily-reports.
 *
 * The reports also live as a tab inside the Execution page, but the client's
 * flow treats them as a first-class destination: the supervisor's task, the
 * QC phase's "what did the site actually report?" panel and anything shared
 * over WhatsApp all need one address that opens straight onto the list, not
 * "open Execution, then find the tab".
 */
export default function DailyReportsPage() {
  const { id } = useParams();
  const { goBack } = useGoBack(`/projects/${id}`);
  const { data: project } = useProject(id);

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-3" style={{ alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-icon" onClick={goBack} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            Daily Site Reports
            <span className="tiny muted" style={{ fontWeight: 500 }}>{project?.name} · {project?.code}</span>
          </span>
        )}
      />
      <div className="content col gap-4">
        <DailySiteReports projectId={id} />
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <Link className="btn btn-subtle btn-sm" to={`/projects/${id}/execution`}>
            <ClipboardList size={13} /> Open Site Execution
          </Link>
        </div>
      </div>
    </>
  );
}
