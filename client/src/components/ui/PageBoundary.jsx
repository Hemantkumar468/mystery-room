import { Component } from 'react';

/**
 * Route-level error boundary. A render error anywhere below used to unmount
 * the whole tree — the page froze white or half-drawn with nothing to act on
 * ("stuck"). This turns the same failure into a visible, recoverable state
 * and logs the real stack to the console for the report.
 */
export class PageBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Page crashed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="content" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="card" style={{ maxWidth: 460, padding: 24, textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>This page hit an error</h2>
          <p className="sm muted" style={{ margin: '0 0 14px' }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}

export default PageBoundary;
