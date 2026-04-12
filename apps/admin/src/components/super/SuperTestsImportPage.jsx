"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";
import { getAdminSupabaseConfig } from "../../lib/adminSupabase";
import { notifyQuestionSetLibraryUpdated } from "../../lib/questionSetLibraryRefresh";

const DEFAULT_DAILY_CATEGORY = "Vocabulary";
const DEFAULT_MODEL_CATEGORY = "Book Review";
const QUESTION_SET_ID_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const QUESTION_SELECT_BASE = "question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data";
const QUESTION_SELECT_WITH_MEDIA = `${QUESTION_SELECT_BASE}, media_file, media_type`;

function getDefaultCategoryForTestType(testType) {
  return testType === "model" ? DEFAULT_MODEL_CATEGORY : DEFAULT_DAILY_CATEGORY;
}

function compareQuestionSetIds(left, right) {
  return QUESTION_SET_ID_COLLATOR.compare(String(left ?? "").trim(), String(right ?? "").trim());
}

function emptyUploadForm() {
  return {
    mode: "create",
    source_question_set_id: "",
    test_type: "daily",
    category: DEFAULT_DAILY_CATEGORY,
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
    test_type: "daily",
    category: DEFAULT_DAILY_CATEGORY,
    version_label: "",
    status: "draft",
    visibility_scope: "global",
    school_ids: [],
  };
}

function getUploadFileKey(file) {
  return [
    file?.webkitRelativePath || "",
    file?.name || "",
    Number(file?.size) || 0,
    Number(file?.lastModified) || 0,
  ].join("::");
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function getUploadFiles(csvFile, assetFiles) {
  const files = [];
  const seen = new Set();

  if (csvFile) {
    const key = getUploadFileKey(csvFile);
    seen.add(key);
    files.push(csvFile);
  }

  (assetFiles ?? []).forEach((file) => {
    const key = getUploadFileKey(file);
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  });

  return files;
}

function createUploadCountEstimator(files, onCountChange) {
  const safeSizes = files.map((file) => Math.max(Number(file?.size) || 0, 1));
  const totalSize = safeSizes.reduce((sum, size) => sum + size, 0) || files.length || 1;
  const thresholds = [];
  let runningTotal = 0;
  safeSizes.forEach((size) => {
    runningTotal += size;
    thresholds.push(runningTotal);
  });

  return ({ loaded, total, lengthComputable }) => {
    const ratio = lengthComputable && total > 0 ? loaded / total : 0;
    const estimatedBytes = Math.max(0, Math.min(totalSize, ratio * totalSize));
    let uploadedCount = 0;
    while (uploadedCount < thresholds.length && estimatedBytes >= thresholds[uploadedCount]) {
      uploadedCount += 1;
    }
    onCountChange(Math.min(files.length, uploadedCount));
  };
}

function statusBadge(status) {
  const normalized = status === "published" ? "active" : "inactive";
  return <span className={`super-status ${normalized}`}>{status}</span>;
}

function formatVersionLabel(item) {
  const label = String(item?.version_label ?? "").trim();
  if (label) return label;
  const version = Number(item?.version ?? 0);
  return version > 0 ? `v${version}` : "v?";
}

function getQuestionSetVersionRank(item) {
  const label = String(item?.version_label ?? "").trim().toLowerCase();
  const match = label.match(/^v(\d+)$/i);
  if (match) return Number(match[1]);
  const version = Number(item?.version ?? 0);
  return Number.isFinite(version) ? version : 0;
}

function selectLatestQuestionSetVersions(list, getKey) {
  const latestByKey = new Map();
  (list ?? []).forEach((item) => {
    const key = String(getKey?.(item) ?? "").trim();
    if (!key) return;
    const current = latestByKey.get(key);
    if (!current) {
      latestByKey.set(key, item);
      return;
    }

    const currentRank = getQuestionSetVersionRank(current);
    const nextRank = getQuestionSetVersionRank(item);
    if (nextRank !== currentRank) {
      if (nextRank > currentRank) latestByKey.set(key, item);
      return;
    }

    const currentTime = new Date(current.updated_at || current.created_at || 0).getTime();
    const nextTime = new Date(item.updated_at || item.created_at || 0).getTime();
    if (nextTime > currentTime) {
      latestByKey.set(key, item);
    }
  });
  return Array.from(latestByKey.values());
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function formatDateTimeParts(value) {
  if (!value) return { date: "N/A", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "N/A", time: "" };
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  };
}

function getAssetProbeTarget(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message ?? "");
  return message.includes(columnName) && message.toLowerCase().includes("does not exist");
}

async function fetchQuestionsForVersionWithFallback(supabase, version) {
  let result = await supabase
    .from("questions")
    .select(QUESTION_SELECT_WITH_MEDIA)
    .eq("test_version", version)
    .order("order_index", { ascending: true });
  if (result.error && (isMissingColumnError(result.error, "media_file") || isMissingColumnError(result.error, "media_type"))) {
    result = await supabase
      .from("questions")
      .select(QUESTION_SELECT_BASE)
      .eq("test_version", version)
      .order("order_index", { ascending: true });
  }
  return result;
}

function isImageAsset(value) {
  const probe = getAssetProbeTarget(value);
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(probe)
    || probe.includes("/images/")
    || probe.includes("/image/");
}

function isAudioAsset(value) {
  const probe = getAssetProbeTarget(value);
  return /\.(mp3|wav|m4a|ogg)(\?.*)?$/i.test(probe)
    || probe.includes("/audio/")
    || probe.includes("/audios/");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderBlankBoxHtml() {
  return '<span style="display:inline-block;width:3.6em;height:0.82lh;border:0.14em solid #ef4444;box-sizing:border-box;vertical-align:-0.02em;margin:0 0.25em;"></span>';
}

function renderUnderlinesHtml(text) {
  const escaped = escapeHtml(text ?? "");
  return escaped
    .replace(/【(.*?)】/g, (_, inner) => (String(inner ?? "").replace(/[\s\u3000]/g, "").length
      ? `<span class="u">${inner}</span>`
      : renderBlankBoxHtml()))
    .replace(/［[\s\u3000]*］|\[[\s\u3000]*\]/g, renderBlankBoxHtml());
}

function splitStemLines(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitStemLinesPreserveIndent(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.replace(/\s+$/g, ""))
    .filter((s) => s.trim().length);
}

function splitTextBoxStemLines(text) {
  const baseLines = splitStemLinesPreserveIndent(text);
  const expanded = [];
  for (const line of baseLines) {
    const speakerMatches = Array.from(
      String(line).matchAll(/(?:^|\s+)([^:：\s]{1,20}[：:].*?)(?=(?:\s+[^:：\s]{1,20}[：:])|$)/g)
    )
      .map((match) => String(match[1] ?? "").trim())
      .filter(Boolean);
    if (speakerMatches.length >= 2) {
      expanded.push(...speakerMatches);
      continue;
    }
    expanded.push(line);
  }
  return expanded;
}

function parseSpeakerStemLine(line) {
  const match = String(line ?? "").match(/^\s*([^:：]+?)([:：])(.*)$/);
  if (!match) return null;
  return {
    speaker: String(match[1] ?? "").trim(),
    delimiter: match[2] ?? "：",
    body: String(match[3] ?? "").replace(/^\s+/g, ""),
  };
}

function normalizeQuestionKind(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s/+]+/g, "_");
}

function hasSpeakerLine(text) {
  return splitStemLinesPreserveIndent(text).some((line) => Boolean(parseSpeakerStemLine(line)?.speaker));
}

function shouldUseSpeakerLayout(question, text) {
  const stemKind = normalizeQuestionKind(question?.stemKind ?? "");
  const type = normalizeQuestionKind(question?.type ?? "");
  const blankStyle = normalizeQuestionKind(question?.blankStyle ?? question?.blank_style ?? "");
  return (
    stemKind === "dialog"
    || stemKind === "text_box"
    || blankStyle === "redbox"
    || type === "mcq_sentence_blank"
    || type === "mcq_dialog"
    || type === "mcq_dialog_with_image"
    || hasSpeakerLine(text)
  );
}

function mapDbQuestion(row) {
  const data = row.data ?? {};
  const stemAsset = [
    row.media_file,
    data.stemAsset,
    data.stem_asset,
    data.stemAudio,
    data.stem_audio,
    data.stemImage,
    data.stem_image,
  ]
    .flatMap((value) => splitStemLines(value))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join("|") || null;
  return {
    id: row.question_id,
    sectionKey: row.section_key,
    type: row.type,
    promptEn: row.prompt_en,
    promptBn: row.prompt_bn,
    answerIndex: row.answer_index,
    orderIndex: row.order_index ?? 0,
    ...data,
    stemKind: data.stemKind ?? data.stem_kind ?? row.media_type ?? null,
    stemAsset,
  };
}

function getPreviewSectionTitle(question) {
  const sectionKey = String(question?.sectionKey ?? "").trim().toUpperCase();
  if (sectionKey === "SV") return "Script and Vocabulary";
  if (sectionKey === "CE") return "Conversation and Expression";
  if (sectionKey === "LC") return "Listening Comprehension";
  if (sectionKey === "RC") return "Reading Comprehension";
  return sectionKey || "Unknown";
}

function resolveMediaUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const { supabaseUrl: baseUrl } = getAdminSupabaseConfig();
  if (!baseUrl) return raw;
  const encodedPath = raw
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${baseUrl}/storage/v1/object/public/test-assets/${encodedPath}`;
}

function ValidationReport({ validation }) {
  if (!validation) return null;

  return (
    <div className="super-validation-panel">
      <div className="super-validation-summary">
        <div className="admin-chip">Sets: {validation.summary?.set_count ?? validation.question_sets?.length ?? 0}</div>
        <div className="admin-chip">Questions: {validation.summary?.question_count ?? 0}</div>
        <div className="admin-chip">Asset refs: {validation.summary?.asset_reference_count ?? 0}</div>
        <div className="admin-chip">{validation.valid ? "Validation passed" : "Validation failed"}</div>
      </div>

      {validation.question_sets?.length ? (
        <div className="admin-help" style={{ marginTop: 8 }}>
          Detected SetIDs: {validation.question_sets.map((item) => item.set_id).join(", ")}
        </div>
      ) : null}

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
  const [testType, setTestType] = useState("daily");
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
  const [uploadProgress, setUploadProgress] = useState({ phase: "", uploaded: 0, total: 0 });
  const [metaCsvFile, setMetaCsvFile] = useState(null);
  const [metaAssetFiles, setMetaAssetFiles] = useState([]);
  const [metaValidation, setMetaValidation] = useState(null);
  const [metaValidationMsg, setMetaValidationMsg] = useState("");
  const [metaUploadProgress, setMetaUploadProgress] = useState({ phase: "", uploaded: 0, total: 0 });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSet, setPreviewSet] = useState(null);
  const [previewQuestions, setPreviewQuestions] = useState([]);
  const [previewMsg, setPreviewMsg] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const assetFolderInputRef = useRef(null);
  const metaAssetFolderInputRef = useRef(null);
  const previewSectionRefs = useRef({});

  const categoryOptionsByTestType = useMemo(() => {
    const next = {
      daily: new Set([DEFAULT_DAILY_CATEGORY]),
      model: new Set([DEFAULT_MODEL_CATEGORY]),
    };
    questionSets.forEach((item) => {
      const normalizedType = item.test_type === "model" ? "model" : "daily";
      const normalizedCategory = String(item.category ?? "").trim();
      if (normalizedCategory) next[normalizedType].add(normalizedCategory);
    });
    return {
      daily: Array.from(next.daily).sort((a, b) => a.localeCompare(b)),
      model: Array.from(next.model).sort((a, b) => a.localeCompare(b)),
    };
  }, [questionSets]);

  const uploadCategoryOptions = categoryOptionsByTestType[uploadForm.test_type === "model" ? "model" : "daily"];
  const uploadCategorySelect = uploadCategoryOptions.includes(uploadForm.category) ? uploadForm.category : "__custom__";
  const metaCategoryOptions = categoryOptionsByTestType[metaForm.test_type === "model" ? "model" : "daily"];
  const metaCategorySelect = metaCategoryOptions.includes(metaForm.category) ? metaForm.category : "__custom__";

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
    return selectLatestQuestionSetVersions(questionSets, (item) => `${item.test_type ?? "daily"}::${item.title}`)
      .slice()
      .sort((left, right) => {
        const idCompare = compareQuestionSetIds(left.title ?? left.version ?? "", right.title ?? right.version ?? "");
        if (idCompare !== 0) return idCompare;
        return String(right.updated_at ?? right.created_at ?? "").localeCompare(String(left.updated_at ?? left.created_at ?? ""));
      })
      .filter((item) => {
        const matchesType = item.test_type === testType;
        const matchesVisibility = visibility === "all" || item.visibility_scope === visibility;
        return matchesType && matchesVisibility;
      });
  }, [questionSets, testType, visibility]);

  const groupedQuestionSets = useMemo(() => {
    const groups = new Map();
    filteredQuestionSets.forEach((item) => {
      const category = String(item.category ?? "").trim() || getDefaultCategoryForTestType(item.test_type);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    });
    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, items]) => ({ category, items }));
  }, [filteredQuestionSets]);
  const previewSectionBreaks = useMemo(() => {
    let previousSectionTitle = "";
    return previewQuestions.map((question, index) => {
      const sectionTitle = getPreviewSectionTitle(question);
      const showHeader = index === 0 || sectionTitle !== previousSectionTitle;
      previousSectionTitle = sectionTitle;
      return { question, index, sectionTitle, showHeader };
    });
  }, [previewQuestions]);
  const previewSectionTitles = useMemo(
    () => previewSectionBreaks.filter((item) => item.showHeader).map((item) => item.sectionTitle),
    [previewSectionBreaks]
  );

  async function invokeJsonFunction(name, payload) {
    const { data, error } = await invokeWithAuth(name, payload);
    if (error) throw new Error(error.message || `Failed to call ${name}`);
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function invokeUploadFunction(name, metadataInput, selectedCsvFile, selectedAssetFiles, setProgress) {
    const metadata = {
      ...metadataInput,
      school_ids: metadataInput.visibility_scope === "restricted" ? metadataInput.school_ids : [],
    };
    const uploadFiles = getUploadFiles(selectedCsvFile, selectedAssetFiles);
    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    if (selectedCsvFile) formData.append("csv", selectedCsvFile);
    uploadFiles
      .filter((file) => !selectedCsvFile || getUploadFileKey(file) !== getUploadFileKey(selectedCsvFile))
      .forEach((file) => formData.append("assets", file));

    const totalFiles = uploadFiles.length;
    const onUploadProgress = totalFiles > 0
      ? createUploadCountEstimator(uploadFiles, (uploaded) => {
        setProgress((current) => {
          if (current.total !== totalFiles || current.uploaded !== uploaded) {
            return { ...current, uploaded, total: totalFiles };
          }
          return current;
        });
      })
      : null;

    const { data, error } = await invokeWithAuth(name, formData, onUploadProgress ? { onUploadProgress } : undefined);
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
    setUploadProgress({ phase: "", uploaded: 0, total: 0 });
    setUploadOpen(true);
  }

  function openMetadataModal(questionSet) {
    setMetaForm({
      question_set_id: questionSet.id,
      title: questionSet.title ?? "",
      test_type: questionSet.test_type ?? "daily",
      category: questionSet.category || getDefaultCategoryForTestType(questionSet.test_type ?? "daily"),
      version_label: `v${Number(questionSet.version ?? 0) + 1}`,
      status: questionSet.status ?? "draft",
      visibility_scope: questionSet.visibility_scope ?? "global",
      school_ids: (questionSet.visible_schools ?? []).map((school) => school.id),
    });
    setMetaCsvFile(null);
    setMetaAssetFiles([]);
    setMetaValidation(null);
    setMetaValidationMsg("");
    setMetaUploadProgress({ phase: "", uploaded: 0, total: 0 });
    setMetaOpen(true);
  }

  function handleUploadTypeChange(nextType) {
    setUploadForm((prev) => ({
      ...prev,
      test_type: nextType,
      category: getDefaultCategoryForTestType(nextType),
    }));
  }

  function handleCsvSelection(file) {
    setCsvFile(file);
    setUploadProgress({ phase: "", uploaded: 0, total: 0 });
  }

  function handleUploadCategoryChange(nextValue) {
    if (nextValue === "__custom__") {
      setUploadForm((prev) => ({
        ...prev,
        category: uploadCategorySelect === "__custom__" ? prev.category : "",
      }));
      return;
    }
    setUploadForm((prev) => ({ ...prev, category: nextValue }));
  }

  function handleMetaTypeChange(nextType) {
    setMetaForm((prev) => ({
      ...prev,
      test_type: nextType,
      category: getDefaultCategoryForTestType(nextType),
    }));
  }

  function handleMetaCategoryChange(nextValue) {
    if (nextValue === "__custom__") {
      setMetaForm((prev) => ({
        ...prev,
        category: metaCategorySelect === "__custom__" ? prev.category : "",
      }));
      return;
    }
    setMetaForm((prev) => ({ ...prev, category: nextValue }));
  }

  function handleAssetFolderSelection(files) {
    setAssetFiles(files);
    setUploadProgress({ phase: "", uploaded: 0, total: 0 });
    const csvExtensions = uploadForm.test_type === "daily" ? [".csv", ".tsv"] : [".csv"];
    const detectedCsv = files.find((file) => csvExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)));
    if (detectedCsv) {
      setCsvFile(detectedCsv);
    }
  }

  function handleMetaCsvSelection(file) {
    setMetaCsvFile(file);
    setMetaUploadProgress({ phase: "", uploaded: 0, total: 0 });
  }

  function handleMetaAssetFolderSelection(files) {
    setMetaAssetFiles(files);
    setMetaUploadProgress({ phase: "", uploaded: 0, total: 0 });
    const csvExtensions = metaForm.test_type === "daily" ? [".csv", ".tsv"] : [".csv"];
    const detectedCsv = files.find((file) => csvExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)));
    if (detectedCsv) {
      setMetaCsvFile(detectedCsv);
    }
  }

  async function validateUpload() {
    if (!csvFile) {
      setValidationMsg("CSV file is required.");
      return null;
    }

    setValidationMsg("");
    try {
      const totalFiles = getUploadFiles(csvFile, assetFiles).length;
      setUploadProgress({ phase: "Validating files", uploaded: 0, total: totalFiles });
      const result = await invokeUploadFunction("validate-question-set-upload", uploadForm, csvFile, assetFiles, setUploadProgress);
      setUploadProgress((current) => ({ ...current, uploaded: current.total }));
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
      const totalFiles = getUploadFiles(csvFile, assetFiles).length;
      setUploadProgress({ phase: "Uploading files", uploaded: 0, total: totalFiles });
      const result = await invokeUploadFunction(functionName, uploadForm, csvFile, assetFiles, setUploadProgress);
      setUploadProgress((current) => ({ ...current, uploaded: current.total }));
      setUploadOpen(false);
      setValidation(null);
      setValidationMsg("");
      setUploadProgress({ phase: "", uploaded: 0, total: 0 });
      const createdCount = result?.question_sets?.length ?? 0;
      setMsg(
        uploadForm.mode === "version"
          ? "Set version uploaded."
          : createdCount > 1
            ? `${createdCount} question sets created.`
            : "Question set created.",
      );
      notifyQuestionSetLibraryUpdated();
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
      if (metaCsvFile) {
        const uploadMetadata = {
          ...metaForm,
          mode: "version",
          source_question_set_id: metaForm.question_set_id,
        };
        const totalFiles = getUploadFiles(metaCsvFile, metaAssetFiles).length;
        setMetaValidationMsg("");
        setMetaUploadProgress({ phase: "Validating files", uploaded: 0, total: totalFiles });
        const validationResult = await invokeUploadFunction(
          "validate-question-set-upload",
          uploadMetadata,
          metaCsvFile,
          metaAssetFiles,
          setMetaUploadProgress,
        );
        setMetaUploadProgress((current) => ({ ...current, uploaded: current.total }));
        setMetaValidation(validationResult.validation ?? null);
        setMetaValidationMsg(validationResult.validation?.valid ? "Validation passed." : "Validation found errors.");
        if (!validationResult.validation?.valid) {
          return;
        }

        setMetaUploadProgress({ phase: "Uploading files", uploaded: 0, total: totalFiles });
        const result = await invokeUploadFunction(
          "upload-question-set-version",
          uploadMetadata,
          metaCsvFile,
          metaAssetFiles,
          setMetaUploadProgress,
        );
        setMetaUploadProgress((current) => ({ ...current, uploaded: current.total }));
        setMsg(
          result?.scope_notice
            ? `Set updated and new version uploaded. ${result.scope_notice}`
            : "Set updated and new version uploaded.",
        );
        notifyQuestionSetLibraryUpdated();
      } else {
        await invokeJsonFunction("update-question-set-metadata", metaForm);
        setMsg("Set metadata updated.");
        notifyQuestionSetLibraryUpdated();
      }
      setMetaOpen(false);
      await loadLibrary();
    } catch (error) {
      setMsg(String(error.message ?? error));
    } finally {
      setSaving(false);
    }
  }

  async function deleteQuestionSetFamily(questionSet) {
    setSaving(true);
    try {
      const result = await invokeJsonFunction("archive-question-set", { question_set_id: questionSet.id });
      console.log("[super-tests-import] archive-question-set response", {
        question_set_id: questionSet.id,
        result,
      });
      setMsg(
        result?.phase === "hard_delete" || result?.deleted_family
          ? "Set deleted."
          : result?.phase === "archive" || result?.archived_family
            ? "Set archived."
            : "Set updated.",
      );
      notifyQuestionSetLibraryUpdated();
      setDeleteTarget(null);
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
    const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, questionSet.title);
    if (error) {
      setPreviewMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = (data ?? []).map(mapDbQuestion);
    setPreviewQuestions(list);
    setPreviewMsg(list.length ? "" : "No questions.");
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewSet(null);
    setPreviewQuestions([]);
    setPreviewMsg("");
  }

  function openDeleteModal(questionSet) {
    setDeleteTarget(questionSet);
  }

  function closeDeleteModal() {
    if (saving) return;
    setDeleteTarget(null);
  }

  function renderQuestionSetTable(items) {
    return (
      <div className="admin-table-wrap super-library-table-wrap">
        <table className="admin-table" style={{ minWidth: 1180 }}>
          <thead>
            <tr>
              <th>SetID</th>
              <th>Ver.</th>
              <th>Questions</th>
              <th>Visibility</th>
              <th>Preview</th>
              <th>Manage</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const createdParts = formatDateTimeParts(item.created_at ?? item.updated_at);
              return (
                <tr key={item.id}>
                  <td>
                    <div className="super-library-set-cell">
                      <div className="daily-name">{item.title}</div>
                      <div className="super-library-set-created">
                        <div>{createdParts.date}</div>
                        <div>{createdParts.time}</div>
                      </div>
                      {item.status === "archived" ? (
                        <div style={{ marginTop: 6 }}>
                          {statusBadge(item.status)}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td>{formatVersionLabel(item)}</td>
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
                  <td>
                    <button className="btn" onClick={() => openPreview(item)}>Preview</button>
                  </td>
                  <td>
                    <button className="btn" onClick={() => openMetadataModal(item)}>Edit</button>
                  </td>
                  <td>
                    <button
                      className="btn btn-danger"
                      onClick={() => openDeleteModal(item)}
                    >
                      {item.status === "archived" ? "Hard Delete" : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="super-toolbar">
          <div style={{ marginBottom: 8 }}>
            <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" onClick={openCreateModal}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M10 13V4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M6.75 7.75 10 4.5l3.25 3.25"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4.5 14.5v1h11v-1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Upload Question Sets
            </button>
          </div>
        </div>

        <div className="super-library-tabs" style={{ marginTop: 10 }}>
          <button
            className={`super-library-tab ${testType === "daily" ? "active" : ""}`}
            type="button"
            onClick={() => setTestType("daily")}
          >
            Daily Test
          </button>
          <button
            className={`super-library-tab ${testType === "model" ? "active" : ""}`}
            type="button"
            onClick={() => setTestType("model")}
          >
            Model Test
          </button>
        </div>

        <div className="admin-form" style={{ marginTop: 12 }}>
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

        {loading ? <div className="admin-help" style={{ marginTop: 12 }}>Loading sets...</div> : null}
        {!loading && groupedQuestionSets.length === 0 ? (
          <div className="admin-help" style={{ marginTop: 12 }}>No sets to show yet.</div>
        ) : null}
        {!loading ? (
          <div className="super-library-sections">
            {groupedQuestionSets.map((group) => (
              <section key={group.category} className="super-library-section">
                <div className="super-library-section-head">
                  <div className="super-library-section-title">{group.category}</div>
                  <div className="admin-help">{group.items.length} set{group.items.length === 1 ? "" : "s"}</div>
                </div>
                {renderQuestionSetTable(group.items)}
              </section>
            ))}
          </div>
        ) : null}
      </div>

      {uploadOpen ? (
        <div className="admin-modal-overlay" onClick={() => setUploadOpen(false)}>
          <div className="admin-modal upload-question-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">Upload Question Sets</div>
              <button className="admin-modal-close" onClick={() => setUploadOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="admin-form upload-question-form" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Test Type</label>
                <select
                  value={uploadForm.test_type}
                  disabled={uploadForm.mode === "version"}
                  onChange={(event) => handleUploadTypeChange(event.target.value)}
                >
                  <option value="daily">Daily Test</option>
                  <option value="model">Model Test</option>
                </select>
              </div>
              <div className="field">
                <label>Category</label>
                <select
                  value={uploadCategorySelect}
                  onChange={(event) => handleUploadCategoryChange(event.target.value)}
                >
                  {uploadCategoryOptions.map((category) => (
                    <option key={`${uploadForm.test_type}-${category}`} value={category}>{category}</option>
                  ))}
                  <option value="__custom__">Custom...</option>
                </select>
                {uploadCategorySelect === "__custom__" ? (
                  <input
                    value={uploadForm.category}
                    onChange={(event) => setUploadForm((prev) => ({ ...prev, category: event.target.value }))}
                    style={{ marginTop: 6 }}
                  />
                ) : null}
              </div>
              <div className="field">
                <label>CSV File (required)</label>
                <input
                  type="file"
                  accept={uploadForm.test_type === "daily" ? ".csv,.tsv" : ".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"}
                  onChange={(event) => handleCsvSelection(event.target.files?.[0] ?? null)}
                />
                {csvFile ? (
                  <div className="admin-help" style={{ marginTop: 4 }}>
                    CSV ready: {csvFile.name}
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Folder (PNG/MP3)</label>
                <div className="upload-question-picker">
                  <input
                    ref={assetFolderInputRef}
                    className="upload-question-picker-input"
                    type="file"
                    multiple
                    accept={uploadForm.test_type === "daily" ? ".csv,.tsv,.png,.jpg,.jpeg,.webp" : ".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"}
                    webkitdirectory="true"
                    directory="true"
                    onChange={(event) => handleAssetFolderSelection(Array.from(event.target.files ?? []))}
                  />
                  <button className="btn upload-question-picker-button" type="button" onClick={() => assetFolderInputRef.current?.click()}>
                    Choose Folder
                  </button>
                </div>
                {assetFiles.length ? (
                  <div className="admin-help" style={{ marginTop: 4 }}>
                    Selected: {assetFiles.length} files
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Visibility</label>
                <select
                  value={uploadForm.visibility_scope}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                >
                  <option value="global">All schools</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
              {uploadForm.visibility_scope === "restricted" ? (
                <div className="field">
                  <label>Visible Schools</label>
                  <SchoolSelector
                    schools={schools}
                    selected={uploadForm.school_ids}
                    onChange={(nextSchoolIds) => setUploadForm((prev) => ({ ...prev, school_ids: nextSchoolIds }))}
                  />
                </div>
              ) : null}
              <div className="upload-question-actions">
                <button className="btn btn-primary" onClick={saveUpload} disabled={saving}>
                  {saving ? "Uploading..." : uploadForm.mode === "version" ? "Upload New Version" : "Create Question Sets"}
                </button>
              </div>
              {uploadProgress.total > 0 ? (
                <div className="admin-help" style={{ marginTop: 4 }}>
                  {uploadProgress.phase || "Uploading files"}: {Math.min(uploadProgress.uploaded, uploadProgress.total)} / {uploadProgress.total}
                </div>
              ) : null}
            </div>
            {validationMsg ? <div className="admin-msg">{validationMsg}</div> : null}
            <ValidationReport validation={validation} />
            <div className="admin-help" style={{ marginTop: 8 }}>
              SetID is read from the CSV `set_id` column. If the file is missing `set_id`, the upload will fail. If the file contains multiple `set_id` values, each one is imported as a separate question set.
            </div>
            <div className="admin-help" style={{ marginTop: 8 }}>
              Template: <a href="/daily_question_csv_template.csv" download>Daily CSV template</a>
            </div>
            <div className="admin-help" style={{ marginTop: 4 }}>
              Template: <a href="/question_csv_template.csv" download>Model CSV template</a>
            </div>
          </div>
        </div>
      ) : null}

      {metaOpen ? (
        <div className="admin-modal-overlay" onClick={() => setMetaOpen(false)}>
          <div className="admin-modal upload-question-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">{metaCsvFile ? "Upload New Version" : "Edit Question Set"}</div>
              <button className="admin-modal-close" onClick={() => setMetaOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="admin-form upload-question-form" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Test Type</label>
                <select
                  value={metaForm.test_type}
                  onChange={(event) => handleMetaTypeChange(event.target.value)}
                >
                  <option value="daily">Daily Test</option>
                  <option value="model">Model Test</option>
                </select>
              </div>
              <div className="field">
                <label>SetID</label>
                <input
                  value={metaForm.title}
                  readOnly={Boolean(metaCsvFile)}
                  onChange={(event) => setMetaForm((prev) => ({ ...prev, title: event.target.value }))}
                />
                {metaCsvFile ? (
                  <div className="admin-help" style={{ marginTop: 4 }}>
                    The SetID stays fixed for version uploads.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>{metaCsvFile ? "Category for New Version" : "Category"}</label>
                <select
                  value={metaCategorySelect}
                  onChange={(event) => handleMetaCategoryChange(event.target.value)}
                >
                  {metaCategoryOptions.map((category) => (
                    <option key={`${metaForm.test_type}-${category}`} value={category}>{category}</option>
                  ))}
                  <option value="__custom__">Custom...</option>
                </select>
                {metaCategorySelect === "__custom__" ? (
                  <input
                    value={metaForm.category}
                    onChange={(event) => setMetaForm((prev) => ({ ...prev, category: event.target.value }))}
                    style={{ marginTop: 6 }}
                  />
                ) : null}
              </div>
              <div className="field">
                <label>CSV File</label>
                <input
                  type="file"
                  accept={metaForm.test_type === "daily" ? ".csv,.tsv" : ".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"}
                  onChange={(event) => handleMetaCsvSelection(event.target.files?.[0] ?? null)}
                />
                {metaCsvFile ? (
                  <div className="admin-help" style={{ marginTop: 4 }}>
                    CSV ready: {metaCsvFile.name}. Uploading this file will create the next version for this SetID.
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Folder (PNG/MP3)</label>
                <div className="upload-question-picker">
                  <input
                    ref={metaAssetFolderInputRef}
                    className="upload-question-picker-input"
                    type="file"
                    multiple
                    accept={metaForm.test_type === "daily" ? ".csv,.tsv,.png,.jpg,.jpeg,.webp" : ".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"}
                    webkitdirectory="true"
                    directory="true"
                    onChange={(event) => handleMetaAssetFolderSelection(Array.from(event.target.files ?? []))}
                  />
                  <button className="btn upload-question-picker-button" type="button" onClick={() => metaAssetFolderInputRef.current?.click()}>
                    Choose Folder
                  </button>
                </div>
                {metaAssetFiles.length ? (
                  <div className="admin-help" style={{ marginTop: 4 }}>
                    Selected: {metaAssetFiles.length} files
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label>Visibility</label>
                <select
                  value={metaForm.visibility_scope}
                  onChange={(event) => setMetaForm((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                >
                  <option value="global">All schools</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
              {metaForm.visibility_scope === "restricted" ? (
                <div className="field">
                  <label>Visible Schools</label>
                  <SchoolSelector
                    schools={schools}
                    selected={metaForm.school_ids}
                    onChange={(nextSchoolIds) => setMetaForm((prev) => ({ ...prev, school_ids: nextSchoolIds }))}
                  />
                </div>
              ) : null}
              <div className="upload-question-actions">
                <button className="btn btn-primary" onClick={saveMetadata} disabled={saving}>
                  {saving ? "Saving..." : metaCsvFile ? "Upload New Version" : "Save Changes"}
                </button>
              </div>
              {metaUploadProgress.total > 0 ? (
                <div className="admin-help" style={{ marginTop: 4 }}>
                  {metaUploadProgress.phase || "Uploading files"}: {Math.min(metaUploadProgress.uploaded, metaUploadProgress.total)} / {metaUploadProgress.total}
                </div>
              ) : null}
            </div>
            {metaValidationMsg ? <div className="admin-msg">{metaValidationMsg}</div> : null}
            <ValidationReport validation={metaValidation} />
            <div className="admin-help" style={{ marginTop: 8 }}>
              When editing an existing set, choose a CSV to create a new version with the same SetID.
            </div>
            <div className="admin-help" style={{ marginTop: 8 }}>
              Template: <a href="/daily_question_csv_template.csv" download>Daily CSV template</a>
            </div>
            <div className="admin-help" style={{ marginTop: 4 }}>
              Template: <a href="/question_csv_template.csv" download>Model CSV template</a>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="admin-modal-overlay" onClick={closeDeleteModal}>
          <div className="admin-modal super-question-set-delete-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">
                {deleteTarget.status === "archived" ? "Hard Delete Question Set" : "Archive Question Set"}
              </div>
              <button className="admin-modal-close" onClick={closeDeleteModal} aria-label="Close" disabled={saving}>
                ×
              </button>
            </div>

            <div className="super-question-set-delete-body">
              <div className="admin-help">
                {deleteTarget.status === "archived" ? (
                  <>
                    Permanently delete <b>{deleteTarget.title}</b> and all of its versions? This cannot be undone, but the SetID will be reusable after deletion.
                  </>
                ) : (
                  <>
                    Archive <b>{deleteTarget.title}</b> and all of its versions first. After that, the button will change to Hard Delete so the SetID can be removed permanently.
                  </>
                )}
              </div>
              <div className="super-question-set-delete-actions">
                <button className="btn" type="button" onClick={closeDeleteModal} disabled={saving}>
                  Cancel
                </button>
                <button className="btn btn-danger" type="button" onClick={() => deleteQuestionSetFamily(deleteTarget)} disabled={saving}>
                  {saving ? "Deleting..." : deleteTarget.status === "archived" ? "Delete Permanently" : "Archive"}
                </button>
              </div>
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
                {previewSet?.test_type === "model" && previewSectionTitles.length ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {previewSectionTitles.map((sectionTitle) => (
                      <button
                        key={`super-preview-jump-${sectionTitle}`}
                        className="btn"
                        type="button"
                        onClick={() => previewSectionRefs.current[sectionTitle]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      >
                        {sectionTitle}
                      </button>
                    ))}
                  </div>
                ) : null}
                {previewSectionBreaks.map(({ question, index, sectionTitle, showHeader }) => {
                  const prompt = question.promptEn || question.promptBn || "";
                  const choices = question.choices ?? question.choicesJa ?? [];
                  const stemKind = question.stemKind || "";
                  const stemText = question.stemText;
                  const stemExtra = question.stemExtra;
                  const stemAsset = resolveMediaUrl(
                    question.stemAsset ||
                    question.image ||
                    question.stemImage ||
                    question.passageImage ||
                    question.tableImage ||
                    question.stem_image ||
                    question.stem_image_url ||
                    null,
                  );
                  const boxText = question.boxText;
                  const isImageStem = ["image", "passage_image", "table_image"].includes(stemKind);
                  const isAudioStem = stemKind === "audio";
                  const shouldShowImage = isImageStem || (!stemKind && isImageAsset(stemAsset));
                  const shouldShowAudio = isAudioStem || (!stemKind && isAudioAsset(stemAsset));
                  const stemLines = splitStemLines(stemExtra);
                  const stemSourceText = stemExtra || stemText || "";
                  const useSpeakerLayout = shouldUseSpeakerLayout(question, stemSourceText);
                  const speakerLines = useSpeakerLayout ? splitTextBoxStemLines(stemSourceText) : [];
                  return (
                    <div key={`${question.qid}-${index}`}>
                      {previewSet?.test_type === "model" && showHeader ? (
                        <div
                          ref={(node) => {
                            if (node) previewSectionRefs.current[sectionTitle] = node;
                          }}
                          className="admin-title"
                          style={{ fontSize: 22, marginTop: index === 0 ? 0 : 6 }}
                        >
                          {sectionTitle}
                        </div>
                      ) : null}
                      <div className="admin-panel" style={{ padding: 14, marginTop: previewSet?.test_type === "model" && showHeader ? 8 : 0 }}>
                      <div style={{ fontSize: 12, color: "#333333", fontWeight: 700 }}>
                        {question.id} {question.sectionKey ? `(${question.sectionKey})` : ""}
                      </div>
                      {prompt ? <div style={{ marginTop: 6, fontSize: 16, fontWeight: 600, whiteSpace: "pre-wrap" }}>{prompt}</div> : null}
                      {question.type === "daily" && stemExtra ? (
                        <div style={{ marginTop: 6, fontSize: 13, color: "#333333", whiteSpace: "pre-wrap" }}>
                          {stemExtra}
                        </div>
                      ) : null}
                      {stemText && !useSpeakerLayout ? (
                        <div
                          style={{ marginTop: 6, whiteSpace: "pre-wrap" }}
                          dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(stemText) }}
                        />
                      ) : null}
                      {useSpeakerLayout && speakerLines.length ? (
                        <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                          {speakerLines.map((line, lineIndex) => {
                            const parsed = parseSpeakerStemLine(line);
                            if (!parsed || !parsed.speaker) {
                              return (
                                <div
                                  key={`${question.id}-textbox-line-${lineIndex}`}
                                  dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(line) }}
                                />
                              );
                            }
                            return (
                              <div
                                key={`${question.id}-textbox-line-${lineIndex}`}
                                style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: "0.45em", alignItems: "start" }}
                              >
                                <span style={{ whiteSpace: "nowrap" }}>{parsed.speaker}{parsed.delimiter}</span>
                                <span dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(parsed.body) }} />
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {stemLines.length && question.type !== "daily" && !useSpeakerLayout ? (
                        <div style={{ marginTop: 6 }}>
                          {stemLines.map((line, lineIndex) => (
                            <div
                              key={`${question.id}-line-${lineIndex}`}
                              dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(line) }}
                            />
                          ))}
                        </div>
                      ) : null}
                      {boxText ? (
                        <div
                          className="boxed"
                          style={{ marginTop: 8 }}
                          dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(boxText) }}
                        />
                      ) : null}
                      {shouldShowImage && stemAsset ? (
                        <img
                          src={stemAsset}
                          alt="stem"
                          style={{ marginTop: 8, maxWidth: "100%", borderRadius: 12, border: "1px solid #d0d5dd" }}
                        />
                      ) : null}
                      {shouldShowAudio && stemAsset ? (
                        <audio controls src={stemAsset} style={{ marginTop: 8, width: "100%" }} />
                      ) : null}
                      {choices.length ? (
                        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                          {choices.map((choice, optionIndex) => {
                            const optionUrl = resolveMediaUrl(choice);
                            const isCorrect = question.answerIndex === optionIndex;
                            return (
                              <div
                                key={`${question.id}-option-${optionIndex}`}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 10,
                                  border: isCorrect ? "2px solid #3b7f1e" : "1px solid #d0d5dd",
                                  background: isCorrect ? "#eef8e8" : "#fff",
                                  fontWeight: isCorrect ? 700 : 400,
                                }}
                              >
                                {optionUrl && isImageAsset(optionUrl) ? (
                                  <img
                                    src={optionUrl}
                                    alt=""
                                    style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 8 }}
                                  />
                                ) : optionUrl && isAudioAsset(optionUrl) ? (
                                  <audio controls src={optionUrl} style={{ width: "100%" }} />
                                ) : (
                                  String(choice ?? "")
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      </div>
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
