"use client";

import AdminLoadingState from "./AdminLoadingState";

const LOADING_PREFIXES = [
  "loading",
  "uploading",
  "saving",
  "refreshing",
];

function isBusyMessage(message) {
  const normalized = String(message ?? "").trim().toLowerCase();
  return LOADING_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export default function AdminStatusMessage({
  message,
  className = "admin-msg",
  style,
}) {
  if (!message) return null;
  if (isBusyMessage(message)) {
    return (
      <div className={className} style={style}>
        <AdminLoadingState compact label={String(message)} />
      </div>
    );
  }
  return (
    <div className={className} style={style}>
      {message}
    </div>
  );
}
