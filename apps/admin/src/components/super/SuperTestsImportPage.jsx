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
    category: "Vocabulary",
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
    category: "Vocabulary",
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

function isImageAsset(value) {
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(String(value ?? "").trim());
}

function isAudioAsset(value) {
  return /\.(mp3|wav|m4a|ogg)$/i.test(String(value ?? "").trim());
}

function renderQuestionPrompt(item) {
  return String(item?.question_text ?? "").trim();
}

function resolveMediaUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!baseUrl) return raw;
  return `${baseUrl}/storage/v1/object/public/test-assets/${raw}`;
}

function CsvGuideline({ testType }) {
  if (testType === "daily") {
    return (
      <div className="admin-help" style={{ marginTop: 12 }}>
        Daily test CSV headers used:
        <code> no </code>, <code>question</code>, <code>correct_answer</code>, <code>wrong_option_1</code>, <code>wrong_option_2</code>, <code>wrong_option_3</code>, <code>illustration</code>, <code>description</code>.
        Extra headers are ignored. If <code>description</code> is present, it will appear under the question in the daily preview.
      </div>
    );
  }

  return (
    <div className="admin-help" style={{ marginTop: 12 }}>
      Model test CSV:
      Required columns: <code>qid</code>, <code>question_text</code>, <code>question_type</code>, <code>correct_answer</code>.
      Optional columns: <code>options</code>, <code>media_file</code>, <code>media_type</code>, <code>order_index</code>, <code>metadata</code>.
      Use this for full model-test uploads, including mixed question types and any referenced assets.
    </div>
  );
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSet, setPreviewSet] = useState(null);
  const [previewQuestions, setPreviewQuestions] = useState([]);
  const [previewMsg, setPreviewMsg] = useState("");

  async function loadLibrary() {
    setLoading(true);
    setMsg("");

    const [questionSetsRes, visibilityRes, schoolsRes, questionsRes, legacyTestsRes] = await Promise.all([
      supabase
        .from("question_sets")
        .select("id, library_key, source_question_set_id, title, description, test_type, version, version_label, status, visibility_scope, created_at, updated_at")
        .order("updated_at", { ascending: false }),
      supabase
        .from("question_set_school_access")
        .select("question_set_id, school_id"),
      supabase
        .from("schools")
        .select("id, name")
        .order("name", { ascending: true }),
      supabase
        .from("question_set_questions")
        .select("question_set_id"),
      supabase
        .from("tests")
        .select("version, title, type"),
    ]);

    if (questionSetsRes.error) {
      setQuestionSets([]);
      setSchools([]);
      setMsg(`Failed to load question-set library: ${questionSetsRes.error.message}`);
      setLoading(false);
      return;
    }

    const schoolMap = Object.fromEntries((schoolsRes.data ?? []).map((school) => [school.id, school]));
    const questionCountBySet = {};
    for (const row of questionSetsRes.data ?? []) {
      questionCountBySet[row.id] = 0;
    }
    const visibilityBySet = {};
    for (const row of visibilityRes.data ?? []) {
      visibilityBySet[row.question_set_id] = visibilityBySet[row.question_set_id] ?? [];
      if (schoolMap[row.school_id]) visibilityBySet[row.question_set_id].push(schoolMap[row.school_id]);
    }

    for (const row of (questionsRes.data ?? [])) {
      if (!row?.question_set_id) continue;
      questionCountBySet[row.question_set_id] = (questionCountBySet[row.question_set_id] ?? 0) + 1;
    }
    const legacyTestBySetId = Object.fromEntries((legacyTestsRes.data ?? []).map((row) => [row.version, row]));

    setSchools(schoolsRes.data ?? []);
    setQuestionSets(
      (questionSetsRes.data ?? []).map((item) => ({
        ...item,
        category: legacyTestBySetId[item.title]?.title ?? (item.test_type === "daily" ? "Vocabulary" : "Book Review"),
        question_count: questionCountBySet[item.id] ?? 0,
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
      return matchesType && matchesVisibility;
    });
  }, [questionSets, testType, visibility]);

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
      category: "Vocabulary",
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
      category: "Vocabulary",
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
      return null;
    }

    setValidationMsg("");
    try {
      const result = await invokeUploadFunction("validate-question-set-upload");
      setValidation(result.validation ?? null);
      setValidationMsg(result.validation?.valid ? "Validation passed." : "Validation found errors.");
      return result.validation ?? null;
    } catch (error) {
      setValidation(null);
      setValidationMsg(String(error.message ?? error));
      return null;
    }
  }

  async function saveUpload() {
    setSaving(true);
    setValidationMsg("");
    try {
      const nextValidation = await validateUpload();
      if (!nextValidation?.valid) {
        if (!nextValidation) {
          setValidationMsg((current) => current || "Validation failed.");
        }
        return;
      }

      const functionName = uploadForm.mode === "version" ? "upload-question-set-version" : "create-question-set";
      await invokeUploadFunction(functionName);
      setUploadOpen(false);
      setValidation(null);
      setValidationMsg("");
      setMsg(uploadForm.mode === "version" ? "Set version uploaded." : "Set created.");
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
      setMsg("Set metadata updated.");
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
      setMsg("Set archived.");
      await loadLibrary();
    } catch (error) {
      setMsg(String(error.message ?? error));
    } finally {
      setSaving(false);
    }
  }

  async function openPreview(questionSet) {
    setPreviewSet(questionSet);
    setPreviewQuestions([]);
    setPreviewMsg("Loading...");
    setPreviewOpen(true);
    const { data, error } = await supabase
      .from("question_set_questions")
      .select("qid, question_text, question_type, correct_answer, options, media_type, media_url, order_index, metadata")
      .eq("question_set_id", questionSet.id)
      .order("order_index", { ascending: true });
    if (error) {
      setPreviewMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setPreviewQuestions(list);
    setPreviewMsg(list.length ? "" : "No questions.");
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewSet(null);
    setPreviewQuestions([]);
    setPreviewMsg("");
  }

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="super-toolbar">
          <div>
            <div className="admin-title">Set Library</div>
            <div className="admin-help">
              Upload shared sets, create new versions, and control school visibility.
            </div>
          </div>
          <button className="btn btn-primary" onClick={openCreateModal}>Upload Set</button>
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
              <option value="global">All schools</option>
              <option value="restricted">Restricted</option>
            </select>
          </div>
        </div>

        {msg ? <div className="admin-msg">{msg}</div> : null}

        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 1320 }}>
            <thead>
              <tr>
                <th>Created</th>
                <th>Category</th>
                <th>SetID</th>
                <th>Questions</th>
                <th>Visibility</th>
                <th>Version</th>
                <th>Preview</th>
                <th>Manage</th>
                <th>New Version</th>
                <th>Archive</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuestionSets.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.created_at ?? item.updated_at)}</td>
                  <td>{item.category || (item.test_type === "daily" ? "Vocabulary" : "Book Review")}</td>
                  <td>
                    <div className="daily-name">{item.title}</div>
                    <div className="daily-code">{item.test_type === "daily" ? "Daily" : "Model"}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{item.question_count ?? 0}</td>
                  <td>
                    <div style={{ fontWeight: 700 }}>
                      {item.visibility_scope === "global" ? "All schools" : "Restricted"}
                    </div>
                    {item.visibility_scope === "restricted" ? (
                      <div className="daily-code">
                        {(item.visible_schools ?? []).map((school) => school.name).join(", ") || "No schools"}
                      </div>
                    ) : null}
                  </td>
                  <td>{item.version_label || `v${item.version}`}</td>
                  <td>
                    <button className="btn" onClick={() => openPreview(item)}>Preview</button>
                  </td>
                  <td>
                    <button className="btn" onClick={() => openMetadataModal(item)}>Edit</button>
                  </td>
                  <td>
                    <button className="btn" onClick={() => openVersionModal(item)}>Upload</button>
                  </td>
                  <td>
                    {item.status !== "archived" ? (
                      <button className="btn btn-danger" onClick={() => archiveQuestionSet(item.id)}>Archive</button>
                    ) : statusBadge(item.status)}
                  </td>
                </tr>
              ))}
              {!loading && filteredQuestionSets.length === 0 ? (
                <tr>
                  <td colSpan={10}>No sets to show yet.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={10}>Loading sets...</td>
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
                {uploadForm.mode === "version" ? "Upload Set Version" : "Create Set"}
              </div>
              <button className="admin-modal-close" onClick={() => setUploadOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="admin-form" style={{ marginTop: 12 }}>
              <div className="field">
                <label>SetID</label>
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
                  onChange={(event) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      test_type: event.target.value,
                      category: event.target.value === "daily" ? prev.category || "Vocabulary" : "",
                    }))
                  }
                >
                  <option value="daily">Daily</option>
                  <option value="model">Model</option>
                </select>
              </div>
              {uploadForm.test_type === "daily" ? (
                <div className="field small">
                  <label>Category</label>
                  <select
                    value={uploadForm.category}
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, category: event.target.value }))}
                  >
                    <option value="Vocabulary">Vocabulary</option>
                  </select>
                </div>
              ) : null}
              <div className="field small">
                <label>Version Label</label>
                <input
                  value={uploadForm.version_label}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, version_label: event.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Visibility</label>
                <select
                  value={uploadForm.visibility_scope}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                >
                  <option value="global">All schools</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
              <div className="field">
                <label>CSV Upload</label>
                <input type="file" accept=".csv,text/csv" onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)} />
              </div>
              <div className="field">
                <label>Image/audio upload</label>
                <input
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.mp3,.wav,.m4a,.ogg"
                  webkitdirectory=""
                  directory=""
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

            <CsvGuideline testType={uploadForm.test_type} />
            {validationMsg ? <div className="admin-msg">{validationMsg}</div> : null}
            <ValidationReport validation={validation} />

            <div className="admin-actions" style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={saveUpload} disabled={saving}>
                {saving ? "Uploading..." : "Upload / Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {metaOpen ? (
        <div className="admin-modal-overlay" onClick={() => setMetaOpen(false)}>
          <div className="admin-modal super-upload-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">Edit Set Metadata</div>
              <button className="admin-modal-close" onClick={() => setMetaOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="admin-form" style={{ marginTop: 12 }}>
              <div className="field">
                <label>SetID</label>
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
                <label>Visibility</label>
                <select
                  value={metaForm.visibility_scope}
                  onChange={(event) => setMetaForm((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                >
                  <option value="global">All schools</option>
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

      {previewOpen ? (
        <div className="admin-modal-overlay" onClick={closePreview}>
          <div
            className="admin-modal"
            style={{ maxWidth: 1100, width: "min(1100px, calc(100vw - 32px))" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-modal-header">
              <div>
                <div className="admin-title">Preview: {previewSet?.title || ""}</div>
                <div className="admin-help">
                  Total: <b>{previewQuestions.length}</b>
                </div>
              </div>
              <button className="admin-modal-close" onClick={closePreview} aria-label="Close">
                ×
              </button>
            </div>

            {previewMsg ? <div className="admin-msg" style={{ marginTop: 12 }}>{previewMsg}</div> : null}

            {!previewMsg ? (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14, maxHeight: "70vh", overflow: "auto" }}>
                {previewQuestions.map((question, index) => {
                  const options = Array.isArray(question.options) ? question.options : [];
                  const correctAnswer = question.correct_answer;
                  const description = String(question.metadata?.description ?? "").trim();
                  const mediaUrl = resolveMediaUrl(question.media_url);
                  return (
                    <div key={`${question.qid}-${index}`} className="admin-panel" style={{ padding: 14 }}>
                      <div style={{ fontSize: 12, color: "#667085", fontWeight: 700 }}>
                        {question.qid} {question.question_type ? `(${question.question_type})` : ""}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 16, fontWeight: 600 }}>
                        {renderQuestionPrompt(question)}
                      </div>
                      {description ? (
                        <div style={{ marginTop: 6, fontSize: 13, color: "#667085" }}>
                          {description}
                        </div>
                      ) : null}
                      {mediaUrl && isImageAsset(mediaUrl) ? (
                        <div style={{ marginTop: 10 }}>
                          <img
                            src={mediaUrl}
                            alt=""
                            style={{ maxWidth: "100%", borderRadius: 12, border: "1px solid #d0d5dd" }}
                          />
                        </div>
                      ) : null}
                      {mediaUrl && isAudioAsset(mediaUrl) ? (
                        <div style={{ marginTop: 10 }}>
                          <audio controls src={mediaUrl} style={{ width: "100%" }} />
                        </div>
                      ) : null}
                      {options.length ? (
                        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                          {options.map((option, optionIndex) => {
                            const isCorrect = typeof correctAnswer === "number"
                              ? correctAnswer === optionIndex
                              : String(option ?? "").trim() === String(correctAnswer ?? "").trim();
                            return (
                              <div
                                key={`${question.qid}-option-${optionIndex}`}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 10,
                                  border: isCorrect ? "2px solid #3b7f1e" : "1px solid #d0d5dd",
                                  background: isCorrect ? "#eef8e8" : "#fff",
                                  fontWeight: isCorrect ? 700 : 400,
                                }}
                              >
                                {String(option ?? "")}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
