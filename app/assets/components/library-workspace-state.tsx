"use client";

import { Component, type ReactNode } from "react";

export function LibraryWorkspaceLoading({ title }: { title: string }) {
  return (
    <section className="shadcn-prototype-workshop-empty" role="status" aria-live="polite">
      <div>
        <span className="shadcn-prototype-library-loading" aria-hidden="true" />
        <strong>{`正在加载${title}…`}</strong>
      </div>
    </section>
  );
}

type LibraryWorkspaceErrorBoundaryProps = {
  children: ReactNode;
  onReload?: () => void;
};

type LibraryWorkspaceErrorBoundaryState = {
  failed: boolean;
};

export class LibraryWorkspaceErrorBoundary extends Component<
  LibraryWorkspaceErrorBoundaryProps,
  LibraryWorkspaceErrorBoundaryState
> {
  state: LibraryWorkspaceErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): LibraryWorkspaceErrorBoundaryState {
    return { failed: true };
  }

  private reload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    if (this.state.failed) {
      return (
        <section className="shadcn-prototype-workshop-empty" role="alert">
          <div>
            <strong>加载失败，请重新加载</strong>
            <p>内容暂时无法显示，重新加载后即可继续。</p>
            <button type="button" onClick={this.reload}>重新加载</button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
