import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  public render(): React.ReactNode {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; path?: string; operationType?: string };
        if (parsed?.error) {
          friendly = `${parsed.error}${parsed.path ? ` (${parsed.operationType ?? 'op'} on ${parsed.path})` : ''}`;
        }
      } catch {
        // non-JSON message
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--pastel-canvas)] text-[var(--pastel-ink)]">
          <div className="max-w-md w-full bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-2xl p-8 space-y-4">
            <h1 className="text-xl font-semibold tracking-tight">Something interrupted your session</h1>
            <p className="text-sm text-[var(--pastel-muted)] leading-relaxed break-words">
              {friendly}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium rounded-xl bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] hover:opacity-90 transition-opacity cursor-pointer"
            >
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
