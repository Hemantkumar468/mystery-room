import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search, Plus, Building2, AlertTriangle, RefreshCw, Users, X, Globe,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Spinner } from '../../components/ui/primitives.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  useCompanies, useCompany, useCreateCompany, useUpdateCompany,
} from '../../app/api/crmApi.js';
import './crm.css';

/**
 * The businesses behind the contacts.
 *
 * Small on purpose. A company record earns its place by answering two
 * questions — who works there, and what is open with them — so the list shows
 * a head count and the drawer shows the people and the deals. Everything else
 * a company could carry is a field somebody has to maintain for no reader.
 */

function CompanyForm({ open, company, onClose }) {
  const isEdit = Boolean(company?._id);
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit) await update.mutateAsync({ id: company._id, ...form });
      else await create.mutateAsync(form);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save that company.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit company' : 'New company'}
      width={480}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-subtle" onClick={onClose}>Cancel</button>
          <button type="submit" form="crm-company-form" className="btn btn-primary">Save</button>
        </div>
      )}
    >
      <form id="crm-company-form" onSubmit={submit} className="crm-form">
        {error && <div className="crm-form__error">{error}</div>}
        <label className="crm-form__field">
          <span className="crm-form__label">Company name<em aria-hidden> *</em></span>
          <input
            className="input" required autoFocus
            defaultValue={company?.name || ''} onChange={(e) => set('name', e.target.value)}
          />
        </label>
        <div className="crm-form__pair">
          <label className="crm-form__field">
            <span className="crm-form__label">City</span>
            <input className="input" defaultValue={company?.city || ''} onChange={(e) => set('city', e.target.value)} />
          </label>
          <label className="crm-form__field">
            <span className="crm-form__label">Phone</span>
            <input className="input" defaultValue={company?.phone || ''} onChange={(e) => set('phone', e.target.value)} />
          </label>
        </div>
        <label className="crm-form__field">
          <span className="crm-form__label">Website</span>
          <input
            className="input" type="url" placeholder="https://…"
            defaultValue={company?.website || ''} onChange={(e) => set('website', e.target.value)}
          />
        </label>
      </form>
    </Modal>
  );
}

function CompanyDrawer({ id, onClose }) {
  const { data, isLoading } = useCompany(id);
  const [editing, setEditing] = useState(false);
  if (!id) return null;

  const company = data?.company;

  return (
    <>
      <div className="crm-scrim" role="presentation" onClick={onClose} />
      <aside className="crm-drawer" aria-label="Company details">
        <header className="crm-drawer__head">
          <div style={{ minWidth: 0 }}>
            <strong className="crm-drawer__name">{company?.name || 'Company'}</strong>
            {company && <div className="crm-muted crm-drawer__sub">{company.city || '—'}</div>}
          </div>
          <div className="row gap-1">
            {company && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
            )}
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>

        {isLoading && <div style={{ padding: 24 }}><Spinner label="Loading…" /></div>}

        {company && (
          <div className="crm-drawer__body">
            {company.website && (
              <a className="crm-chip" href={company.website} target="_blank" rel="noreferrer">
                <Globe size={14} aria-hidden /> {company.website.replace(/^https?:\/\//, '')}
              </a>
            )}

            <section>
              <h3 className="crm-section__title"><Users size={14} aria-hidden /> People here</h3>
              {data.contacts?.length ? (
                <ul className="crm-minilist">
                  {data.contacts.map((c) => (
                    <li key={c._id}>
                      <Link to={`/crm/contacts?open=${c._id}`}>
                        <strong>{c.name}</strong>
                        <span className="crm-muted">{[c.designation, c.phone].filter(Boolean).join(' · ')}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="crm-muted">Nobody is recorded at this company yet.</p>
              )}
            </section>

            {Boolean(data.deals?.length) && (
              <section>
                <h3 className="crm-section__title">Deals</h3>
                <ul className="crm-minilist">
                  {data.deals.map((d) => (
                    <li key={d._id}>
                      <Link to={`/crm/pipeline?open=${d._id}`}>
                        <strong>{d.title}</strong>
                        <span className="crm-muted">
                          {d.value ? `₹${(d.value / 100000).toFixed(1)}L` : ''}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </aside>

      <CompanyForm open={editing} company={company} onClose={() => setEditing(false)} />
    </>
  );
}

export function CompanyListPage() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);

  const query = { search: params.get('search') || undefined, sort: params.get('sort') || undefined };
  const { data, isFetching, isError, refetch } = useCompanies(query);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <Topbar
        title="Companies"
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New company
          </button>
        )}
      />

      <div className="content col gap-4">
        <div className="crm-toolbar">
          <label className="crm-search">
            <Search size={15} aria-hidden />
            <input
              className="crm-search__input"
              placeholder="Search name, city, website…"
              defaultValue={query.search || ''}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter('search', e.currentTarget.value.trim()); }}
              aria-label="Search companies"
            />
          </label>
          <button
            type="button" className="btn btn-ghost btn-icon"
            onClick={refetch} title="Refresh" aria-label="Refresh"
          >
            <RefreshCw size={15} className={isFetching ? 'crm-spin' : undefined} />
          </button>
        </div>

        {isError ? (
          <EmptyState icon={AlertTriangle} title="That list could not be loaded" />
        ) : !data ? (
          <div className="sm muted" style={{ padding: 24 }}>Loading…</div>
        ) : !data.items.length ? (
          <EmptyState
            icon={Building2}
            title="No companies yet"
            hint="Add one, or let a qualified lead create it."
          />
        ) : (
          <div className="crm-rows">
            {data.items.map((c) => (
              <button
                type="button" key={c._id} className="crm-row crm-row--company"
                onClick={() => setFilter('open', c._id)}
              >
                <span className="crm-row__who">
                  <strong>{c.name}</strong>
                  <span className="crm-muted">{c.city || '—'}</span>
                </span>
                {/* The head count is what makes a company row worth reading —
                    a name with nothing behind it answers no question. */}
                <span className="crm-muted">
                  {c.contactCount} {c.contactCount === 1 ? 'person' : 'people'}
                </span>
                <span className="crm-muted crm-row__when">{c.owner?.name || ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <CompanyForm open={adding} onClose={() => setAdding(false)} />
      <CompanyDrawer id={params.get('open')} onClose={() => setFilter('open', '')} />
    </>
  );
}

export default CompanyListPage;
