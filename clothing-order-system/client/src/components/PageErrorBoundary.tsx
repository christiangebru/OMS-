import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button";

type Props = { children: ReactNode; title?: string };

type State = { error: Error | null };

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[page]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="border border-line bg-surface p-6">
        <p className="text-sm font-semibold text-ink">{this.props.title || "This view failed"}</p>
        <p className="mt-2 text-sm text-ink-muted">
          {this.state.error.message || "An unexpected error occurred. The rest of OMS is still available."}
        </p>
        <Button
          type="button"
          className="mt-4"
          variant="secondary"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </Button>
      </div>
    );
  }
}
