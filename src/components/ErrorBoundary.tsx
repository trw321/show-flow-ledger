import { Component, ErrorInfo, ReactNode } from 'react';
import posthog from 'posthog-js';
import { clearAllData } from '@/lib/store';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    posthog.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center gap-3">
          <p className="text-lg font-semibold">Something went wrong</p>
          <p className="text-sm text-muted-foreground font-mono">{this.state.error?.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm underline text-muted-foreground hover:text-foreground"
          >
            Reload app
          </button>
          <p className="text-xs text-muted-foreground/60 max-w-sm mt-4">
            If reloading keeps landing back here, your saved data may be the cause.
          </p>
          <button
            onClick={() => {
              if (window.confirm('This permanently erases all jobs, income, expenses, and equipment stored in this browser. Continue?')) {
                clearAllData();
              }
            }}
            className="text-xs underline text-destructive/70 hover:text-destructive"
          >
            Reset all data (last resort — cannot be undone)
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
