import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('ErrorBoundary caught an error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-white rounded-lg shadow text-center">
          <h3 className="text-lg font-bold text-red-600">Something went wrong</h3>
          <p className="mt-2 text-sm text-gray-600">An error occurred while loading this section. Check the console for details.</p>
          <pre className="mt-3 text-xs text-left whitespace-pre-wrap text-gray-700">{this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

export default ErrorBoundary;
