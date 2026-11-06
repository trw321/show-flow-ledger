import { Component, ErrorInfo, ReactNode } from 'react';
import posthog from 'posthog-js';
import { clearAllData, saveLedgerCopy } from '@/lib/store';
import { reportCrash } from '@/lib/problemLog';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; saved?: boolean; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    posthog.captureException(error, { extra: { componentStack: info.componentStack } });
    reportCrash(`${error.message}${info.componentStack ?? ''}`);
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
          <p className="text-sm max-w-sm mt-4">Your data is still here. Nothing has been deleted.</p>
          <button
            onClick={() => { void saveLedgerCopy().then(saved => this.setState({ saved })); }}
            className="text-sm underline text-foreground"
          >
            Save a copy of my data
          </button>
          {/* The wipe stays out of reach until there's a copy: this can be the
              only one, and a crash is the worst moment to be offered it. */}
          {this.state.saved && (
            <button
              onClick={() => {
                if (window.confirm('This permanently erases all jobs, income, expenses, and equipment stored in this browser. Continue?')) {
                  clearAllData();
                }
              }}
              className="text-xs underline text-destructive/70 hover:text-destructive mt-4"
            >
              Reset all data (last resort, cannot be undone)
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * A crash in one page, with the app still standing around it: the menu works,
 * so Settings, Money and signing in can still be reached, and moving to another
 * page clears it.
 */
export class PageBoundary extends Component<Props & { page: string }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    posthog.captureException(error, { extra: { componentStack: info.componentStack } });
    reportCrash(`${error.message}${info.componentStack ?? ''}`);
  }

  componentDidUpdate(prev: { page: string }) {
    if (this.state.hasError && prev.page !== this.props.page) this.setState({ hasError: false, error: null });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center" data-testid="page-crash">
        <p className="text-lg font-semibold">This page hit a problem</p>
        <p className="text-sm">Your data is still here. Nothing has been deleted.</p>
        <p className="text-sm text-muted-foreground font-mono">{this.state.error?.message}</p>
        <button onClick={() => window.location.reload()} className="text-sm underline text-muted-foreground hover:text-foreground">
          Reload
        </button>
        <button onClick={() => void saveLedgerCopy()} className="text-sm underline text-foreground">
          Save a copy of my data
        </button>
      </div>
    );
  }
}
