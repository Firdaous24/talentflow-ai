import { Component } from "react";
import type { ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Something went wrong</h1>
        <p>
          Reload to reopen your workspace. In-session candidate data will be
          cleared.
        </p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
