"use client";

import React from "react";
import { logError, type ErrorContext } from "@/lib/errorLogger";

interface Props {
  fallback?: React.ReactNode;
  children: React.ReactNode;
  context?: ErrorContext;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  componentStack?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logError(error, this.props.context ?? {}, info.componentStack ?? undefined);
    this.setState({ componentStack: info.componentStack ?? undefined });
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: undefined, componentStack: undefined });
    this.props.onRetry?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-lg border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
            <p className="font-medium">Something went wrong.</p>
            <p className="mt-1 text-xs opacity-80">{this.state.error?.message}</p>
            <button
              onClick={this.handleRetry}
              className="mt-3 rounded bg-danger/15 px-3 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/25"
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
