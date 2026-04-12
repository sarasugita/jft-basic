"use client";

import { createPortal } from "react-dom";

function renderSetIdList(items) {
  const list = (items ?? [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (!list.length) {
    return <div className="admin-help">None detected.</div>;
  }

  return (
    <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
      {list.map((item) => (
        <li key={item} style={{ marginBottom: 4 }}>
          <b>{item}</b>
        </li>
      ))}
    </ul>
  );
}

export default function QuestionSetUploadConflictModal({
  open,
  title,
  description,
  duplicateSetIds = [],
  allSetIds = [],
  allActionLabel = "Upload All and Update Existing SetIDs",
  newOnlyActionLabel = "Upload Only New SetIDs",
  cancelLabel = "Cancel",
  allActionHint = "",
  newOnlyActionHint = "",
  onAll,
  onNewOnly,
  onCancel,
}) {
  if (!open || typeof document === "undefined") return null;

  return createPortal((
    <div className="admin-modal-overlay" onClick={onCancel}>
      <div
        className="admin-modal upload-question-modal"
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth: 680, width: "min(680px, calc(100vw - 28px))" }}
      >
        <div className="admin-modal-header">
          <div className="admin-title">{title}</div>
          <button className="admin-modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>

        {description ? <div className="admin-help" style={{ marginTop: 12 }}>{description}</div> : null}

        <div className="admin-form" style={{ marginTop: 12 }}>
          <div className="field">
            <label>Existing SetIDs</label>
            {renderSetIdList(duplicateSetIds)}
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>SetIDs in this upload</label>
            {renderSetIdList(allSetIds)}
          </div>
        </div>

        <div className="upload-question-actions" style={{ marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" onClick={onAll}>
            {allActionLabel}
          </button>
          {allActionHint ? <div className="admin-help" style={{ width: "100%" }}>{allActionHint}</div> : null}
          <button className="btn" type="button" onClick={onNewOnly}>
            {newOnlyActionLabel}
          </button>
          {newOnlyActionHint ? <div className="admin-help" style={{ width: "100%" }}>{newOnlyActionHint}</div> : null}
          <button className="btn" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
