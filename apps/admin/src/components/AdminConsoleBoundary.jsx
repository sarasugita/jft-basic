"use client";

import { Component } from "react";
import { logAdminRequestFailure } from "../lib/adminDiagnostics";

export default class AdminConsoleBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    logAdminRequestFailure("Admin console render failed", error, {
      componentStack: info?.componentStack ?? "",
      context: this.props.context ?? "unknown",
    });
  }

  render() {
    const { error } = this.state;
    const { children, onRetry, onBack, backLabel = "Back" } = this.props;

    if (error) {
      return (
        <div className="admin-login">
          <h2>Startup Error</h2>
          <div className="admin-msg">
            Failed to render the admin console. Retry or go back.
          </div>
          {typeof onRetry === "function" ? (
            <button
              className="admin-password-change-secondary"
              type="button"
              onClick={() => {
                this.setState({ error: null }, () => {
                  onRetry();
                });
              }}
            >
              RETRY
            </button>
          ) : null}
          {typeof onBack === "function" ? (
            <button
              className="admin-password-change-secondary"
              type="button"
              onClick={onBack}
            >
              {backLabel}
            </button>
          ) : null}
        </div>
      );
    }

    return children;
  }
}
