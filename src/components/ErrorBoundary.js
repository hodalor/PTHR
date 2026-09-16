import React from 'react';
import { captureException } from '../utils/errorTracking';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    captureException(error, {
      componentStack: errorInfo?.componentStack || '',
      source: 'ErrorBoundary',
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="content-grid">
          <section className="panel table-panel">
            <div className="panel-title-row">
              <div>
                <h2>Something went wrong</h2>
                <p>The app hit an unexpected error. Refresh the page and try again.</p>
              </div>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
