import { Component, ErrorInfo, ReactNode } from 'react';
import posthog from 'posthog-js';

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
        </div>
      );
    }
    return this.props.children;
  }
}
