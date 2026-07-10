import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutTemplate, Layers, ListChecks, Clock, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { useTemplates, useDeleteTemplate } from '../../lib/queries.js';
import { CreateTemplateModal } from './CreateTemplateModal.jsx';

const STATUS_COLORS = {
  draft: { color: '#6b7280' },
  published: { color: '#10b981' },
  archived: { color: '#f59e0b' },
};

/* ---------- Delete Confirmation Modal ---------- */
function DeleteConfirmModal({ template, onClose, onConfirm, isPending }) {
  useEffect(() => {
    if (!template) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [template, onClose]);

  if (!template) return null;
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="modal fade-in"
        style={{ maxWidth: 440 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="card-head">
          <div className="col">
            <div className="section-title">Delete Template</div>
            <div className="sm muted">This action cannot be undone</div>
          </div>
        </div>
        <div className="card-body col gap-3">
          <p style={{ lineHeight: 1.6 }}>
            Are you sure you want to delete{' '}
            <strong>&ldquo;{template.name}&rdquo;</strong>?{' '}
            Any projects currently using this template will remain unaffected, but this playbook will no longer be selectable.
          </p>
        </div>
        <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={isPending}>Cancel</button>
          <button
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={isPending}
            style={{ minWidth: 110 }}
          >
            {isPending ? <span className="spinner" /> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplatesPage() {
  const { data, isLoading } = useTemplates({ limit: 50 });
  const navigate = useNavigate();
  const templates = data?.data || [];

  const deleteTemplate = useDeleteTemplate();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);      // template object to edit
  const [deleteTarget, setDeleteTarget] = useState(null);  // template object to delete
  const [toastMessage, setToastMessage] = useState({ text: '', type: 'success' });

  const showToast = (text, type = 'success') => setToastMessage({ text, type });

  useEffect(() => {
    if (toastMessage.text) {
      const t = setTimeout(() => setToastMessage({ text: '', type: 'success' }), 4000);
      return () => clearTimeout(t);
    }
  }, [toastMessage.text]);

  const handleDeleteConfirm = async () => {
    try {
      await deleteTemplate.mutateAsync(deleteTarget._id);
      showToast(`Template "${deleteTarget.name}" deleted.`, 'danger');
      setDeleteTarget(null);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete template.', 'danger');
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Topbar
        title="Templates"
        subtitle="Reusable launch playbooks — design once, run in every city"
        actions={<button className="btn btn-primary" onClick={() => { setEditTarget(null); setIsCreateModalOpen(true); }}>+ New Template</button>}
      />
      <div className="content">
        <div className="content-narrow fade-in">
          {isLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
              {Array.from({ length: 6 }).map((_, i) => <SkBlock key={i} h={186} />)}
            </div>
          ) : !templates.length ? (
            <EmptyState icon={LayoutTemplate} title="No templates yet" hint="Seed the demo data to load the Franchise Launch playbook." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
              {templates.map((t) => (
                <div
                  key={t._id}
                  className="card card-hover"
                  style={{ cursor: 'pointer', transition: 'var(--transition)', position: 'relative' }}
                  onClick={() => navigate(`/templates/${t._id}`)}
                >
                  <div className="card-body">
                    {/* Top row: icon + status badge + action buttons */}
                    <div className="row between" style={{ marginBottom: 14 }}>
                      <span style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: `${t.color}1e`, color: t.color }}>
                        <LayoutTemplate size={22} />
                      </span>
                      <div className="row gap-2" style={{ alignItems: 'center' }}>
                        <Badge color={STATUS_COLORS[t.status]?.color} dot>{t.status}</Badge>

                        {/* Edit button */}
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Edit template"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditTarget(t);
                            setIsCreateModalOpen(true);
                          }}
                          style={{
                            color: 'var(--text-subtle)',
                            transition: 'color var(--transition)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--info)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-subtle)'}
                        >
                          <Pencil size={14} />
                        </button>

                        {/* Delete button */}
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Delete template"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(t);
                          }}
                          style={{
                            color: 'var(--text-subtle)',
                            transition: 'color var(--transition)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-subtle)'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</div>
                    <div className="mono tiny subtle" style={{ marginTop: 2 }}>{t.code} · v{t.version}</div>
                    <p className="sm muted" style={{ marginTop: 8, minHeight: 38 }}>{t.description}</p>

                    <div className="row gap-4" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <span className="row gap-1 sm muted"><Layers size={14} /> {t.totalStages} stages</span>
                      <span className="row gap-1 sm muted"><ListChecks size={14} /> {t.totalTasks} tasks</span>
                      <span className="row gap-1 sm muted"><Clock size={14} /> ~{t.estimatedDurationDays}d</span>
                      <ChevronRight size={16} className="subtle" style={{ marginLeft: 'auto' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toast notification */}
      {toastMessage.text && (
        <div
          className="fade-in"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 100,
            background: 'var(--surface)',
            border: `1px solid ${toastMessage.type === 'danger' ? 'var(--danger)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius)',
            padding: '12px 20px',
            boxShadow: 'var(--shadow-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            className="badge-dot"
            style={{
              background: toastMessage.type === 'danger' ? 'var(--danger)' : '#10b981',
              width: 8,
              height: 8,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{toastMessage.text}</span>
        </div>
      )}

      {/* Create / Edit modal */}
      <CreateTemplateModal
        open={isCreateModalOpen}
        onClose={() => { setIsCreateModalOpen(false); setEditTarget(null); }}
        initialData={editTarget}
        onSuccess={(name, wasEdit) => {
          showToast(wasEdit
            ? `Template "${name}" updated successfully!`
            : `Template "${name}" created successfully!`
          );
        }}
      />

      {/* Delete confirmation */}
      <DeleteConfirmModal
        template={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        isPending={deleteTemplate.isPending}
      />
    </>
  );
}

export default TemplatesPage;

