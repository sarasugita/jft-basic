"use client";

export default function AdminLoadingState({
  label = "Loading...",
  centered = false,
  compact = false,
  className = "",
}) {
  const classes = [
    "admin-loading-state",
    centered ? "centered" : "",
    compact ? "compact" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} role="status" aria-live="polite" aria-busy="true">
      <span className="attendance-import-status-spinner admin-loading-spinner" aria-hidden="true" />
      <span className="admin-loading-text">{label}</span>
    </div>
  );
}
