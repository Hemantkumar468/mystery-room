import { Component } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

/**
 * A render-error boundary.
 *
 * The app had none before this. That was survivable while every screen was
 * forms and tables — React unmounts the tree on a render error, so the worst
 * case was a blank page after a bad response. It stops being survivable with a
 * WebGL canvas in the tree: MapLibre throws on a lost context, an unsupported
 * driver, or a Worker that will not start in a sandboxed frame, and any of
 * those would take the whole authenticated shell down with it.
 *
 * Deliberately a class. Error boundaries have no hook equivalent —
 * `componentDidCatch`/`getDerivedStateFromError` are the only API React
 * exposes for this, and that has not changed in React 18.
 *
 * Scope it tightly. Wrapping the whole app turns every bug into the same
 * generic panel; wrapping the risky subtree keeps the rest of the page alive
 * and working.
 *
 * @example
 * <ErrorBoundary title="The map failed to load" onReset={refetch}>
 *   <MapCanvas />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No logging service exists in this app, so the console is genuinely where
    // this belongs — swallowing it entirely would leave a developer with a
    // panel and no stack.
    // eslint-disable-next-line no-console
    console.error('Render error caught by ErrorBoundary:', error, info?.componentStack);
    this.props.onError?.(error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { title = 'Something went wrong', hint, fallback } = this.props;
    if (fallback) return fallback(error, this.handleReset);

    return (
      <div
        role="alert"
        className="col gap-3"
        style={{
          padding: 28,
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--surface)',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <AlertTriangle size={28} style={{ color: 'var(--danger)' }} />
        <div className="col gap-1">
          <strong>{title}</strong>
          {hint && <span className="sm muted">{hint}</span>}
          <span className="tiny muted" style={{ overflowWrap: 'anywhere' }}>
            {error.message}
          </span>
        </div>
        <button type="button" className="btn btn-subtle" onClick={this.handleReset}>
          <RotateCw size={14} /> Try again
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
