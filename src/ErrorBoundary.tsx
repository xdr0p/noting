import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in ErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopyError = async () => {
    if (this.state.error) {
      const text = `${this.state.error.name}: ${this.state.error.message}\n${this.state.error.stack || ''}`;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        console.error("Failed to copy error to clipboard", e);
      }
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#121214',
          color: '#e4e4e7',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '24px',
          textAlign: 'center',
          userSelect: 'none'
        }}>
          <h2 style={{ marginBottom: '12px', fontSize: '1.5rem', color: '#f87171' }}>Something went wrong</h2>
          <p style={{ maxWidth: '480px', marginBottom: '24px', color: '#a1a1aa', fontSize: '0.9rem', lineHeight: 1.5 }}>
            An unexpected error occurred. You can reload the application or copy the error details for reporting.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                background: '#3b82f6',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              Reload
            </button>
            <button
              onClick={this.handleCopyError}
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: '1px solid #3f3f46',
                background: '#27272a',
                color: '#e4e4e7',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}
            >
              Copy Error
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
