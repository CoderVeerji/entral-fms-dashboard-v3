import { Component, type ReactNode } from 'react';
import { EmptyState } from './EmptyState';

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  error: Error | null;
}

// Port of app/index.html's per-route ErrorBoundary — a render crash on one page shows a Retry
// card instead of white-screening the whole app. Remount it with key={route} at the call site so
// navigating away and back always gets a fresh boundary.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Page render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card">
          <EmptyState
            icon="fa-triangle-exclamation" title="This page hit an unexpected error"
            subtitle={this.state.error.message}
            action={<button className="btn btn-primary btn-sm" onClick={() => this.setState({ error: null })}><i className="fas fa-rotate-right" /> Retry</button>}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
