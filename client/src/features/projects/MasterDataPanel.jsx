import { useState } from 'react';
import { Database, Save } from 'lucide-react';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useSaveMasterData } from '../../app/api/projectsApi.js';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkeletonCard, SkeletonTileGrid } from '../../components/ui/Skeletons.jsx';
import { NumberInput } from '../../components/ui/NumberInput.jsx';
import { RecordsPanel } from './records/RecordsPanel.jsx';

function Field({ field, value, onChange }) {
  const common = { className: field.type === 'textarea' ? 'textarea' : 'input', value: value ?? '', onChange: (e) => onChange(e.target.value) };
  switch (field.type) {
    case 'textarea':
      return <textarea {...common} placeholder={field.placeholder} />;
    case 'number':
    case 'currency':
      return (
        <NumberInput
          {...common}
          placeholder={field.placeholder || (field.type === 'currency' ? '₹' : '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'date':
      return <input {...common} type="date" value={value ? String(value).slice(0, 10) : ''} />;
    case 'datetime':
      return <input {...common} type="datetime-local" value={value ? String(value).slice(0, 16) : ''} />;
    case 'boolean':
      return (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case 'select':
      return (
        <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    default:
      return <input {...common} placeholder={field.placeholder} />;
  }
}

function StageMasterData({ projectId, stage, schema, initial }) {
  const [values, setValues] = useState(initial || {});
  const [saved, setSaved] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const save = useSaveMasterData(projectId);

  const onSave = async () => {
    await save.mutateAsync({ stageKey: stage.key, values });
    setSaved(true);
    setSavedAt(new Date());
  };

  const meta = STAGE_STATUS_META[stage.status];
  const filled = schema.filter((f) => values[f.key] !== undefined && values[f.key] !== '').length;

  return (
    <div className="card">
      <div className="card-head">
        <div className="row gap-3">
          <span className="badge-dot" style={{ background: stage.color, width: 10, height: 10 }} />
          <div className="col">
            <span className="section-title">{stage.name}</span>
            <span className="tiny muted">{filled}/{schema.length} fields captured · <span style={{ color: meta?.color }}>{meta?.label}</span></span>
          </div>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={onSave}
            disabled={save.isPending}
            style={saved ? { background: '#16a34a', borderColor: '#16a34a' } : undefined}
          >
            {save.isPending ? <span className="spinner" /> : saved ? <><Save size={14} /> Save Again</> : <><Save size={14} /> Save</>}
          </button>
          {savedAt && (
            <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
              Last saved at {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
          {schema.map((f) => (
            <div className="field" key={f.key} style={{ marginBottom: 0 }}>
              <label className="label">{f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
              <Field field={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
              {f.helpText && <span className="tiny subtle">{f.helpText}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MasterDataPanel({ project }) {
  const templateId = project.template?.ref?._id || project.template?.ref;
  const { data: template, isLoading } = useTemplate(templateId);

  if (isLoading) {
    return (
      <div className="col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} title={false}><SkeletonTileGrid count={4} /></SkeletonCard>
        ))}
      </div>
    );
  }
  if (!template) return <EmptyState icon={Database} title="Template unavailable" hint="The source template could not be loaded." />;

  const schemaByStage = Object.fromEntries(
    template.stages.map((s) => [s.key, s.masterDataSchema || []]),
  );
  const stages = [...project.stages].sort((a, b) => a.order - b.order);

  return (
    <div className="col gap-4">
      {stages.map((stage) => {
        const schema = schemaByStage[stage.key] || [];
        if (!schema.length) return null;
        // Collection-mode stages (e.g. Phase 1) capture many rows — render the
        // records workspace. Everything else keeps the single-record form.
        if (stage.captureMode === 'collection') {
          return <RecordsPanel key={stage.key} project={project} stage={stage} schema={schema} />;
        }
        return (
          <StageMasterData
            key={stage.key}
            projectId={project._id}
            stage={stage}
            schema={schema}
            initial={project.masterData?.[stage.key]}
          />
        );
      })}
    </div>
  );
}

export default MasterDataPanel;
