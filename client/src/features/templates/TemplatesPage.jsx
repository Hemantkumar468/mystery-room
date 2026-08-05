import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutTemplate, Layers, ListChecks, Clock, ChevronRight, Pencil, Trash2, Star, CheckSquare, Copy, Archive } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { useTemplates, useDeleteTemplate, useSetDefaultTemplate, useCloneTemplate, useArchiveTemplate } from '../../app/api/templatesApi.js';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectIsAdmin, selectIsManager } from '../../app/slices/authSlice.js';
import { toastPushed } from '../../app/slices/notificationSlice.js';
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
          {template.isDefault && (
            <p
              className="row gap-2 sm"
              style={{
                lineHeight: 1.6,
                color: 'var(--warning)',
                background: 'var(--warning-soft)',
                border: '1px solid var(--warning)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                alignItems: 'flex-start',
              }}
            >
              <Star size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                This is the <strong>default</strong> template. Deleting it leaves no default, and new
                projects will have to pick a playbook manually until you set another one.
              </span>
            </p>
          )}
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
  const setDefaultTemplate = useSetDefaultTemplate();
  const cloneTemplate = useCloneTemplate();
  const archiveTemplate = useArchiveTemplate();

  // Server: template.routes.js requires `canDesign` (admin|manager) for
  // create/edit/setDefault, and admin-only for delete. This page previously
  // had no client-side gate at all, so every action was rendered live for
  // every role and 403'd on click for anyone below manager.
  const isAdmin = useAppSelector(selectIsAdmin);
  const isManager = useAppSelector(selectIsManager);
  const canDesign = isAdmin || isManager;

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);      // template object to edit
  const [deleteTarget, setDeleteTarget] = useState(null);  // template object to delete

  const dispatch = useAppDispatch();
  // Toast display/auto-dismiss now lives in the global ToastHost.
  const showToast = (text, type = 'success') =>
    dispatch(toastPushed({ kind: type === 'danger' ? 'error' : type, message: text }));

  const handleSetDefault = async (template) => {
    if (template.isDefault) return;
    try {
      await setDefaultTemplate.mutateAsync(template._id);
      showToast(`"${template.name}" is now the default template.`);
    } catch (err) {
      // The server rejects drafts — surface that reason rather than a generic failure.
      showToast(err.response?.data?.message || 'Failed to set default template.', 'danger');
    }
  };

  const handleClone = async (template) => {
    try {
      await cloneTemplate.mutateAsync(template._id);
      showToast(`"${template.name}" duplicated as "${template.name} (Copy)".`);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to duplicate template.', 'danger');
    }
  };

  const handleArchive = async (template) => {
    try {
      await archiveTemplate.mutateAsync(template._id);
      showToast(`"${template.name}" archived.`);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to archive template.', 'danger');
    }
  };

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
        actions={canDesign && (
          <button className="btn btn-primary" onClick={() => { setEditTarget(null); setIsCreateModalOpen(true); }}>+ New Template</button>
        )}
      />
      <div className="content">
        <div className="content-narrow fade-in">
          {isLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
              {Array.from({ length: 6 }).map((_, i) => <SkBlock key={i} h={186} />)}
            </div>
          ) : !templates.length ? (
            <EmptyState icon={LayoutTemplate} title="No templates yet" hint="Seed the demo data to load the official 10-phase Store Launch playbook." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
              {templates.map((t) => (
                <div
                  key={t._id}
                  className="card card-hover"
                  style={{
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                    position: 'relative',
                    // The default playbook reads at a glance in a grid of cards.
                    borderColor: t.isDefault ? 'var(--primary)' : undefined,
                  }}
                  onClick={() => navigate(`/templates/${t._id}`)}
                >
                  <div className="card-body">
                    {/* Top row: icon + status badges */}
                    <div className="row between" style={{ marginBottom: 10 }}>
                      <span style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: `${t.color}1e`, color: t.color }}>
                        <LayoutTemplate size={22} />
                      </span>
                      <div className="row gap-2" style={{ alignItems: 'center' }}>
                        {t.isDefault && (
                          <Badge color="#e0a13a" style={{ fontWeight: 700 }}>
                            <Star size={10} fill="#e0a13a" /> Default
                          </Badge>
                        )}
                        <Badge color={STATUS_COLORS[t.status]?.color} dot>{t.status}</Badge>
                      </div>
                    </div>

                    {/* Action buttons row — separated from the badges above so an
                        extra "Default" badge on one card never pushes buttons
                        past the card edge (badges and buttons vary in width
                        independently now). */}
                    <div className="row gap-1" style={{ marginBottom: 14, justifyContent: 'flex-end' }}>
                      {canDesign && (
                        <>
                            {/* Set-as-default button — disabled once this template holds the flag */}
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              title={
                                t.isDefault
                                  ? 'This is the default template'
                                  : t.status === 'published'
                                    ? 'Set as default template'
                                    : 'Publish this template before making it the default'
                              }
                              disabled={t.isDefault || t.status !== 'published' || setDefaultTemplate.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetDefault(t);
                              }}
                              style={{ color: t.isDefault ? 'var(--primary)' : 'var(--text-subtle)' }}
                              onMouseEnter={(e) => { if (!t.isDefault) e.currentTarget.style.color = 'var(--primary)'; }}
                              onMouseLeave={(e) => { if (!t.isDefault) e.currentTarget.style.color = 'var(--text-subtle)'; }}
                            >
                              <Star size={14} fill={t.isDefault ? 'currentColor' : 'none'} />
                            </button>

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

                            {/* Duplicate button — always available, creates a draft copy */}
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              title="Duplicate template"
                              disabled={cloneTemplate.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClone(t);
                              }}
                              style={{
                                color: 'var(--text-subtle)',
                                transition: 'color var(--transition)',
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--info)'}
                              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-subtle)'}
                            >
                              <Copy size={14} />
                            </button>

                            {/* Archive button — retires the playbook; server force-clears isDefault */}
                            {t.status !== 'archived' && (
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                title="Archive template"
                                disabled={archiveTemplate.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleArchive(t);
                                }}
                                style={{
                                  color: 'var(--text-subtle)',
                                  transition: 'color var(--transition)',
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--warning)'}
                                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-subtle)'}
                              >
                                <Archive size={14} />
                              </button>
                            )}
                          </>
                        )}

                        {/* Delete button — admin-only server-side, stricter than canDesign */}
                        {isAdmin && (
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
                        )}
                      </div>

                    <div style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</div>
                    <div className="mono tiny subtle" style={{ marginTop: 2 }}>{t.code} · v{t.version}</div>
                    <p className="sm muted" style={{ marginTop: 8, minHeight: 38 }}>{t.description}</p>

                    <div className="row gap-3 wrap" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <span className="row gap-1 sm muted"><Layers size={14} /> {t.totalStages} phases</span>
                      <span className="row gap-1 sm muted"><ListChecks size={14} /> {t.totalTasks} tasks</span>
                      <span className="row gap-1 sm muted"><CheckSquare size={14} /> {t.totalChecklistItems}</span>
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

