import React, { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends (Component as any)<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-white rounded-lg shadow text-center">
          <h3 className="text-lg font-bold text-red-600">Something went wrong</h3>
          <p className="mt-2 text-sm text-gray-600">An error occurred while loading this section. Check the console for details.</p>
          <pre className="mt-3 text-xs text-left whitespace-pre-wrap text-gray-700">{this.state.error?.message}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
