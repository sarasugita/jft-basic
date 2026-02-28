"use client";

import { useEffect, useMemo, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";

function emptyUploadForm() {
  return {
    mode: "create",
    source_question_set_id: "",
    title: "",
    description: "",
    test_type: "daily",
    version_label: "v1",
    status: "draft",
    visibility_scope: "global",
    school_ids: [],
  };
}

function emptyMetaForm() {
  return {
    question_set_id: "",
    title: "",
    description: "",
    version_label: "",
    status: "draft",
    visibility_scope: "global",
    school_ids: [],
  };
}

function statusBadge(status) {
  const normalized = status === "published" ? "active" : "inactive";
  return <span className={`super-status ${normalized}`}>{status}</span>;
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function ValidationReport({ validation }) {
  if (!validation) return null;

  return (
    <div className="super-validation-panel">
      <div className="super-validation-summary">
        <div className="admin-chip">Questions: {validation.summary?.question_count ?? 0}</div>
        <div className="admin-chip">Asset refs: {validation.summary?.asset_reference_count ?? 0}</div>
        <div className="admin-chip">{validation.valid ? "Validation passed" : "Validation failed"}</div>
      </div>

      {validation.errors?.length ? (
        <div className="super-validation-block error">
          <div className="super-validation-title">Errors</div>
          <ul className="super-validation-list">
            {validation.errors.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}

      {validation.warnings?.length ? (
        <div className="super-validation-block warning">
          <div className="super-validation-title">Warnings</div>
          <ul className="super-validation-list">
            {validation.warnings.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SchoolSelector({ schools, selected, onChange }) {
  return (
    <div className="super-school-selector">
      {schools.map((school) => {
        const checked = selected.includes(school.id);
        return (
          <label key={school.id} className="super-school-option">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                if (event.target.checked) onChange([...selected, school.id]);
                else onChange(selected.filter((item) => item !== school.id));
              }}
            />
            <span>{school.name}</span>
          </label>
        );
      })}
      {schools.length === 0 ? <div className="admin-help">No schools available.</div> : null}
    </div>
  );
}

export default function SuperTestsImportPage() {
  const { supabase, invokeWithAuth } = useSuperAdmin();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [testType, setTestType] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [questionSets, setQuestionSets] = useState([]);
  const [schools, setSchools] = useState([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState(emptyUploadForm());
  const [metaForm, setMetaForm] = useState(emptyMetaForm());
  const [csvFile, setCsvFile] = useState(null);
  const [assetFiles, setAssetFiles] = useState([]);
  const [validation, setValidation] = useState(null);
  const [validationMsg, setValidationMsg] = useState("");

  async function loadLibrary() {
    setLoading(true);
    setMsg("");

    const [questionSetsRes, visibilityRes, schoolsRes] = await Promise.all([
      supabase
        .from("question_sets")
        .select("id, library_key, source_question_set_id, title, description, test_type, version, version_label, status, visibility_scope, updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("question_set_school_access")
        .select("question_set_id, school_id"),
      supabase
        .from("schools")
        .select("id, name")
        .order("name", { ascending: true }),
    ]);

    if (questionSetsRes.error) {
      setQuestionSets([]);
      setSchools([]);
      setMsg(`Failed to load question-set library: ${questionSetsRes.error.message}`);
      setLoading(false);
      return;
    }

    const schoolMap = Object.fromEntries((schoolsRes.data ?? []).map((school) => [school.id, school]));
    const visibilityBySet = {};
    for (const row of visibilityRes.data ?? []) {
      visibilityBySet[row.question_set_id] = visibilityBySet[row.question_set_id] ?? [];
      if (schoolMap[row.school_id]) visibilityBySet[row.question_set_id].push(schoolMap[row.school_id]);
    }

    setSchools(schoolsRes.data ?? []);
    setQuestionSets(
      (questionSetsRes.data ?? []).map((item) => ({
        ...item,
        visible_schools: visibilityBySet[item.id] ?? [],
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    loadLibrary();
  }, [supabase]);

  const filteredQuestionSets = useMemo(() => {
    return questionSets.filter((item) => {
      const matchesType = testType === "all" || item.test_type === testType;
      const matchesVisibility = visibility === "all" || item.visibility_scope === visibility;
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      return matchesType && matchesVisibility && matchesStatus;
    });
  }, [questionSets, testType, visibility, statusFilter]);

  async function invokeJsonFunction(name, payload) {
    const { data, error } = await invokeWithAuth(name, payload);
    if (error) throw new Error(error.message || `Failed to call ${name}`);
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function invokeUploadFunction(name) {
    const metadata = {
      ...uploadForm,
      school_ids: uploadForm.visibility_scope === "restricted" ? uploadForm.school_ids : [],
    };
    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    if (csvFile) formData.append("csv", csvFile);
    assetFiles.forEach((file) => formData.append("assets", file));

    const { data, error } = await invokeWithAuth(name, formData);
    if (error) throw new Error(error.message || `Failed to call ${name}`);
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function openCreateModal() {
    setUploadForm(emptyUploadForm());
    setCsvFile(null);
    setAssetFiles([]);
    setValidation(null);
    setValidationMsg("");
    setUploadOpen(true);
  }

  function openVersionModal(questionSet) {
    setUploadForm({
      mode: "version",
      source_question_set_id: questionSet.id,
      title: questionSet.title ?? "",
      description: questionSet.description ?? "",
      test_type: questionSet.test_type ?? "daily",
      version_label: `v${Number(questionSet.version ?? 0) + 1}`,
      status: "draft",
      visibility_scope: questionSet.visibility_scope ?? "global",
      school_ids: (questionSet.visible_schools ?? []).map((school) => school.id),
    });
    setCsvFile(null);
    setAssetFiles([]);
    setValidation(null);
    setValidationMsg("");
    setUploadOpen(true);
  }

  function openMetadataModal(questionSet) {
    setMetaForm({
      question_set_id: questionSet.id,
      title: questionSet.title ?? "",
      description: questionSet.description ?? "",
      version_label: questionSet.version_label ?? "",
      status: questionSet.status ?? "draft",
      visibility_scope: questionSet.visibility_scope ?? "global",
      school_ids: (questionSet.visible_schools ?? []).map((school) => school.id),
    });
    setMetaOpen(true);
  }

  async function validateUpload() {
    if (!csvFile) {
      setValidationMsg("CSV file is required.");
      return;
    }

    setSaving(true);
    setValidationMsg("");
    try {
      const result = await invokeUploadFunction("validate-question-set-upload");
      setValidation(result.validation ?? null);
      setValidationMsg(result.validation?.valid ? "Validation passed." : "Validation found errors.");
    } catch (error) {
      setValidation(null);
      setValidationMsg(String(error.message ?? error));
    } finally {
      setSaving(false);
    }
  }

  async function saveUpload() {
    if (!validation?.valid) {
      setValidationMsg("Run validation and resolve all errors before saving.");
      return;
    }

    setSaving(true);
    setValidationMsg("");
    try {
      const functionName = uploadForm.mode === "version" ? "upload-question-set-version" : "create-question-set";
      await invokeUploadFunction(functionName);
      setUploadOpen(false);
      setValidation(null);
      setValidationMsg("");
      setMsg(uploadForm.mode === "version" ? "Question-set version uploaded." : "Question set created.");
      await loadLibrary();
    } catch (error) {
      setValidationMsg(String(error.message ?? error));
    } finally {
      setSaving(false);
    }
  }

  async function saveMetadata() {
    setSaving(true);
    try {
      await invokeJsonFunction("update-question-set-metadata", metaForm);
      setMetaOpen(false);
      setMsg("Question-set metadata updated.");
      await loadLibrary();
    } catch (error) {
      setMsg(String(error.message ?? error));
    } finally {
      setSaving(false);
    }
  }

  async function archiveQuestionSet(questionSetId) {
    setSaving(true);
    try {
      await invokeJsonFunction("archive-question-set", { question_set_id: questionSetId });
      setMsg("Question set archived.");
      await loadLibrary();
    } catch (error) {
      setMsg(String(error.message ?? error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="super-toolbar">
          <div>
            <div className="admin-title">Question Set Library</div>
            <div className="admin-help">
              Upload global question sets, create new versions, and control school visibility.
            </div>
          </div>
          <button className="btn btn-primary" onClick={openCreateModal}>Upload Question Set</button>
        </div>

        <div className="admin-form" style={{ marginTop: 12 }}>
          <div className="field small">
            <label>Test Type</label>
            <select value={testType} onChange={(event) => setTestType(event.target.value)}>
              <option value="all">All</option>
              <option value="daily">Daily</option>
              <option value="model">Model</option>
            </select>
          </div>
          <div className="field small">
            <label>Visibility</label>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="all">All</option>
              <option value="global">Global</option>
              <option value="restricted">Restricted</option>
            </select>
          </div>
          <div className="field small">
            <label>Status</label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        {msg ? <div className="admin-msg">{msg}</div> : null}

        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 1180 }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Test Type</th>
                <th>Version</th>
                <th>Visibility</th>
                <th>Status</th>
                <th>Updated At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuestionSets.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="daily-name">{item.title}</div>
                    <div className="daily-code">{item.description || item.library_key}</div>
                  </td>
                  <td style={{ textTransform: "capitalize" }}>{item.test_type}</td>
                  <td>{item.version_label || `v${item.version}`}</td>
                  <td>
                    <div style={{ textTransform: "capitalize", fontWeight: 700 }}>{item.visibility_scope}</div>
                    {item.visibility_scope === "restricted" ? (
                      <div className="daily-code">
                        {(item.visible_schools ?? []).map((school) => school.name).join(", ") || "No schools"}
                      </div>
                    ) : null}
                  </td>
                  <td>{statusBadge(item.status)}</td>
                  <td>{formatDateTime(item.updated_at)}</td>
                  <td>
                    <div className="admin-actions">
                      <button className="btn" onClick={() => openMetadataModal(item)}>View / Manage</button>
                      <button className="btn" onClick={() => openVersionModal(item)}>Upload New Version</button>
                      <button className="btn" onClick={() => openMetadataModal(item)}>Edit Metadata</button>
                      {item.status !== "archived" ? (
                        <button className="btn" onClick={() => archiveQuestionSet(item.id)}>Archive</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredQuestionSets.length === 0 ? (
                <tr>
                  <td colSpan={7}>No question sets to show yet.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={7}>Loading question sets...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {uploadOpen ? (
        <div className="admin-modal-overlay" onClick={() => setUploadOpen(false)}>
          <div className="admin-modal super-upload-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">
                {uploadForm.mode === "version" ? "Upload Question Set Version" : "Create Question Set"}
              </div>
              <button className="admin-modal-close" onClick={() => setUploadOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="admin-form" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Title</label>
                <input
                  value={uploadForm.title}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, title: event.target.value }))}
                />
              </div>
              <div className="field">
                <label>Description</label>
                <textarea
                  value={uploadForm.description}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, description: event.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Test Type</label>
                <select
                  value={uploadForm.test_type}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, test_type: event.target.value }))}
                >
                  <option value="daily">Daily</option>
                  <option value="model">Model</option>
                </select>
              </div>
              <div className="field small">
                <label>Version Label</label>
                <input
                  value={uploadForm.version_label}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, version_label: event.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Status</label>
                <select
                  value={uploadForm.status}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, status: event.target.value }))}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="field small">
                <label>Visibility</label>
                <select
                  value={uploadForm.visibility_scope}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                >
                  <option value="global">Global</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
              <div className="field">
                <label>CSV Upload</label>
                <input type="file" accept=".csv,text/csv" onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)} />
              </div>
              <div className="field">
                <label>Assets Upload</label>
                <input
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.mp3,.wav,.m4a,.ogg"
                  onChange={(event) => setAssetFiles(Array.from(event.target.files ?? []))}
                />
              </div>
            </div>

            {uploadForm.visibility_scope === "restricted" ? (
              <div style={{ marginTop: 12 }}>
                <div className="admin-title" style={{ fontSize: 16 }}>Visible Schools</div>
                <div className="admin-help">Restricted question sets are assignable only to the selected schools.</div>
                <SchoolSelector
                  schools={schools}
                  selected={uploadForm.school_ids}
                  onChange={(nextSchoolIds) => setUploadForm((prev) => ({ ...prev, school_ids: nextSchoolIds }))}
                />
              </div>
            ) : null}

            <div className="admin-help" style={{ marginTop: 12 }}>
              Required CSV columns: <code>qid</code>, <code>question_text</code>, <code>question_type</code>, <code>correct_answer</code>.
              Optional columns: <code>options</code>, <code>media_file</code>, <code>media_type</code>, <code>order_index</code>, <code>metadata</code>.
            </div>
            {validationMsg ? <div className="admin-msg">{validationMsg}</div> : null}
            <ValidationReport validation={validation} />

            <div className="admin-actions" style={{ marginTop: 14 }}>
              <button className="btn" onClick={validateUpload} disabled={saving}>Validate</button>
              <button className="btn btn-primary" onClick={saveUpload} disabled={saving || !validation?.valid}>
                Upload / Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {metaOpen ? (
        <div className="admin-modal-overlay" onClick={() => setMetaOpen(false)}>
          <div className="admin-modal super-upload-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">Edit Question Set Metadata</div>
              <button className="admin-modal-close" onClick={() => setMetaOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="admin-form" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Title</label>
                <input
                  value={metaForm.title}
                  onChange={(event) => setMetaForm((prev) => ({ ...prev, title: event.target.value }))}
                />
              </div>
              <div className="field">
                <label>Description</label>
                <textarea
                  value={metaForm.description}
                  onChange={(event) => setMetaForm((prev) => ({ ...prev, description: event.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Version Label</label>
                <input
                  value={metaForm.version_label}
                  onChange={(event) => setMetaForm((prev) => ({ ...prev, version_label: event.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Status</label>
                <select
                  value={metaForm.status}
                  onChange={(event) => setMetaForm((prev) => ({ ...prev, status: event.target.value }))}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="field small">
                <label>Visibility</label>
                <select
                  value={metaForm.visibility_scope}
                  onChange={(event) => setMetaForm((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                >
                  <option value="global">Global</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
            </div>

            {metaForm.visibility_scope === "restricted" ? (
              <div style={{ marginTop: 12 }}>
                <div className="admin-title" style={{ fontSize: 16 }}>Visible Schools</div>
                <SchoolSelector
                  schools={schools}
                  selected={metaForm.school_ids}
                  onChange={(nextSchoolIds) => setMetaForm((prev) => ({ ...prev, school_ids: nextSchoolIds }))}
                />
              </div>
            ) : null}

            <div className="admin-help" style={{ marginTop: 12 }}>
              Metadata edits do not modify existing questions. Upload a new version to change question content.
            </div>

            <div className="admin-actions" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={saveMetadata} disabled={saving}>Save Metadata</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
