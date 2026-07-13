import { NumberInput } from '../../../components/ui/NumberInput.jsx';

/**
 * Renders one input for a dynamic field definition
 * `{ key, label, type, required, options, placeholder, helpText }`.
 *
 * One branch per field type — adding a new type later is a self-contained change.
 * `onChange` receives the raw value (not an event), matching the rest of the app.
 *
 * NOTE (M1): `file` fields capture an attachment *reference* (a URL or filename)
 * as text. The binary upload pipeline (presigned URLs / object storage) is a
 * later milestone — see docs/02-Phase-1-Build-Spec.md §3.
 */
export function DynamicField({ field, value, onChange }) {
  const type = field.type || 'text';

  switch (type) {
    case 'textarea':
      return (
        <textarea
          className="textarea"
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'number':
    case 'currency':
      return (
        <NumberInput
          className="input"
          value={value ?? ''}
          placeholder={field.placeholder || (type === 'currency' ? '₹' : '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'date':
      return (
        <input
          className="input"
          type="date"
          value={value ? String(value).slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

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
          {(field.options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      const toggle = (opt) =>
        onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
      return (
        <div className="row wrap gap-2">
          {(field.options || []).map((o) => {
            const on = selected.includes(o);
            return (
              <button
                type="button"
                key={o}
                className={`chip ${on ? 'chip-on' : ''}`}
                onClick={() => toggle(o)}
                style={{
                  padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                  background: on ? 'var(--primary-soft, rgba(224,161,58,0.16))' : 'var(--surface)',
                  color: on ? 'var(--primary)' : 'var(--text-muted)', fontSize: 13,
                }}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }

    case 'file':
      return (
        <input
          className="input"
          value={value ?? ''}
          placeholder={field.placeholder || 'Paste a link or filename…'}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default:
      return (
        <input
          className="input"
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export default DynamicField;
