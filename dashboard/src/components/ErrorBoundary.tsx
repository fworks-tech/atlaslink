"use client";

import React from "react";

interface Props {
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("ErrorBoundary caught", error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-lg border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
            <p className="font-medium">Something went wrong.</p>
            <p className="mt-1 text-xs opacity-80">{this.state.error?.message}</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
