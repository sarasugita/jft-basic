"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 29);
  return {
    from: toDateInput(from),
    to: toDateInput(now),
  };
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return `${Math.round(Number(value) * 100)}%`;
}

function getAttemptScore(attempt) {
  if (attempt?.score_rate != null && Number.isFinite(Number(attempt.score_rate))) {
    return Number(attempt.score_rate);
  }
  const total = Number(attempt?.total ?? 0);
  if (!total) return null;
  return Number(attempt?.correct ?? 0) / total;
}

function getQuestionPrompt(question) {
  const promptBn = String(question?.metadata?.prompt_bn ?? "").trim();
  const stemText = String(question?.metadata?.stem_text ?? "").trim();
  const boxText = String(question?.metadata?.box_text ?? "").trim();
  const questionText = String(question?.question_text ?? "").trim();
  return questionText || promptBn || stemText || boxText || question?.qid || "Untitled question";
}

function getSectionTitle(sectionKey) {
  if (sectionKey === "SV") return "Script and Vocabulary";
  if (sectionKey === "CE") return "Conversation and Expression";
  if (sectionKey === "LC") return "Listening Comprehension";
  if (sectionKey === "RC") return "Reading Comprehension";
  if (sectionKey === "DAILY") return "Daily";
  return sectionKey || "Question";
}

function formatSubSectionLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const labelMap = {
    word_meaning: "Word Meaning",
    word_usage: "Word Usage",
    kanji_reading: "Kanji Reading",
    kanji_meaning_and_usage: "Kanji Usage",
    kanji_usage: "Kanji Usage",
    grammar: "Grammar",
    expression: "Expression",
    comprehending_content_conversation: "Conversation",
    conversation: "Conversation",
    comprehending_content_communicating_at_shops_and_public_places: "Shops and Public Places",
    public_place: "Shops and Public Places",
    shops_and_public_places: "Shops and Public Places",
    comprehending_content_listening_to_announcements_and_instructions: "Announcements and Instructions",
    announcement: "Announcements and Instructions",
    announcements_and_instructions: "Announcements and Instructions",
    comprehending_content: "Comprehension",
    comprehension: "Comprehension",
    info_search: "Information Search",
    information_search: "Information Search",
  };
  return labelMap[normalized] || raw;
}

function formatSubSectionTwoLines(value) {
  const label = formatSubSectionLabel(value);
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return label;
  const midpoint = Math.ceil(words.length / 2);
  return `${words.slice(0, midpoint).join(" ")}\n${words.slice(midpoint).join(" ")}`;
}

function getQuestionSection(question) {
  return getSectionTitle(String(question?.metadata?.section_key ?? "").trim());
}

function getQuestionSubSection(question) {
  return formatSubSectionLabel(question?.metadata?.section_label)
    || formatSubSectionLabel(question?.metadata?.section_key)
    || String(question?.question_type ?? "").trim()
    || "Question";
}

function resolveCorrectAnswerIndex(question) {
  const raw = question?.correct_answer;
  if (raw == null || raw === "" || String(raw).trim().toLowerCase() === "blank") {
    return -1;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  const options = Array.isArray(question?.options) ? question.options : [];
  const target = String(raw ?? "").trim();
  if (!target) return null;
  const exactIndex = options.findIndex((option) => String(option ?? "").trim() === target);
  if (exactIndex !== -1) return exactIndex;
  const normalizedIndex = options.findIndex(
    (option) => String(option ?? "").trim().toLowerCase() === target.toLowerCase(),
  );
  return normalizedIndex !== -1 ? normalizedIndex : null;
}

function isQuestionAnswerCorrect(question, answerValue) {
  const correctIndex = resolveCorrectAnswerIndex(question);
  if (correctIndex != null) {
    if (correctIndex === -1) {
      return answerValue == null || answerValue === -1 || String(answerValue).trim() === "";
    }
    return Number(answerValue) === correctIndex;
  }
  return String(answerValue ?? "").trim() === String(question?.correct_answer ?? "").trim();
}

export default function SuperQuestionSetComparisonPage({ questionSetId }) {
  const { supabase } = useSuperAdmin();
  const [filters, setFilters] = useState({
    schoolId: "all",
    ...defaultRange(),
  });
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [questionSet, setQuestionSet] = useState(null);
  const [questionSetQuestions, setQuestionSetQuestions] = useState([]);
  const [questionSetAttempts, setQuestionSetAttempts] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadSchools() {
      const { data } = await supabase.from("schools").select("id, name").order("name", { ascending: true });
      if (cancelled) return;
      setSchools(data ?? []);
    }

    loadSchools();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function loadComparison() {
      if (!questionSetId) {
        setQuestionSet(null);
        setQuestionSetQuestions([]);
        setQuestionSetAttempts([]);
        setMsg("Question set not found.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setMsg("");

      const schoolIdParam = filters.schoolId === "all" ? null : filters.schoolId;
      const [questionSetRes, questionsRes, instancesRes, directAttemptsRes, legacyAttemptsRes] = await Promise.all([
        supabase
          .from("question_sets")
          .select("id, title, version_label, version, test_type, status, visibility_scope")
          .eq("id", questionSetId)
          .maybeSingle(),
        supabase
          .from("question_set_questions")
          .select("id, question_set_id, qid, question_text, question_type, correct_answer, options, order_index, metadata")
          .eq("question_set_id", questionSetId)
          .order("order_index", { ascending: true }),
        (() => {
          let query = supabase
            .from("test_instances")
            .select("id")
            .eq("question_set_id", questionSetId);
          if (schoolIdParam) query = query.eq("school_id", schoolIdParam);
          return query;
        })(),
        (() => {
          let query = supabase
            .from("attempts")
            .select("id, school_id, question_set_id, test_instance_id, test_version, correct, total, score_rate, answers_json, created_at")
            .eq("question_set_id", questionSetId);
          if (schoolIdParam) query = query.eq("school_id", schoolIdParam);
          if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
          if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999`);
          return query;
        })(),
        (() => {
          let query = supabase
            .from("attempts")
            .select("id, school_id, question_set_id, test_instance_id, test_version, correct, total, score_rate, answers_json, created_at");
          if (schoolIdParam) query = query.eq("school_id", schoolIdParam);
          if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
          if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999`);
          return query;
        })(),
      ]);

      if (cancelled) return;

      if (questionSetRes.error || questionsRes.error || instancesRes.error || directAttemptsRes.error || legacyAttemptsRes.error) {
        setMsg(
          questionSetRes.error?.message
            || questionsRes.error?.message
            || instancesRes.error?.message
            || directAttemptsRes.error?.message
            || legacyAttemptsRes.error?.message
            || "Failed to load question-set comparison.",
        );
        setQuestionSet(null);
        setQuestionSetQuestions([]);
        setQuestionSetAttempts([]);
        setLoading(false);
        return;
      }

      if (!questionSetRes.data) {
        setMsg("Question set not found.");
        setQuestionSet(null);
        setQuestionSetQuestions([]);
        setQuestionSetAttempts([]);
        setLoading(false);
        return;
      }

      const instanceIds = (instancesRes.data ?? []).map((row) => row.id).filter(Boolean);
      let instanceAttempts = { data: [], error: null };
      if (instanceIds.length) {
        let attemptsQuery = supabase
          .from("attempts")
          .select("id, school_id, question_set_id, test_instance_id, test_version, correct, total, score_rate, answers_json, created_at")
          .in("test_instance_id", instanceIds);
        if (filters.from) attemptsQuery = attemptsQuery.gte("created_at", `${filters.from}T00:00:00`);
        if (filters.to) attemptsQuery = attemptsQuery.lte("created_at", `${filters.to}T23:59:59.999`);
        instanceAttempts = await attemptsQuery;
        if (cancelled) return;
      }

      if (instanceAttempts.error) {
        setMsg(instanceAttempts.error.message || "Failed to load question-set attempts.");
        setQuestionSet(null);
        setQuestionSetQuestions([]);
        setQuestionSetAttempts([]);
        setLoading(false);
        return;
      }

      const fallbackTitle = String(questionSetRes.data.title ?? "").trim();
      const dedupedAttempts = new Map();
      [...(directAttemptsRes.data ?? []), ...(instanceAttempts.data ?? [])].forEach((row) => {
        if (!row?.id) return;
        dedupedAttempts.set(row.id, row);
      });
      (legacyAttemptsRes.data ?? []).forEach((row) => {
        if (!row?.id || !fallbackTitle) return;
        if (String(row.test_version ?? "").trim() !== fallbackTitle) return;
        dedupedAttempts.set(row.id, row);
      });

      setQuestionSet(questionSetRes.data);
      setQuestionSetQuestions(questionsRes.data ?? []);
      setQuestionSetAttempts(Array.from(dedupedAttempts.values()));
      setLoading(false);
    }

    loadComparison();
    return () => {
      cancelled = true;
    };
  }, [filters, questionSetId, supabase]);

  const schoolMap = useMemo(
    () => Object.fromEntries((schools ?? []).map((school) => [school.id, school.name])),
    [schools],
  );

  const schoolRows = useMemo(() => {
    const stats = new Map();

    for (const attempt of questionSetAttempts) {
      const schoolId = attempt?.school_id;
      if (!schoolId) continue;
      const current = stats.get(schoolId) || {
        school_id: schoolId,
        school_name: schoolMap[schoolId] ?? schoolId,
        attempts_count: 0,
        score_sum: 0,
        score_count: 0,
      };
      current.attempts_count += 1;
      const score = getAttemptScore(attempt);
      if (score != null) {
        current.score_sum += score;
        current.score_count += 1;
      }
      stats.set(schoolId, current);
    }

    return Array.from(stats.values())
      .map((row) => ({
        ...row,
        avg_score: row.score_count ? row.score_sum / row.score_count : null,
      }))
      .sort((left, right) => {
        if (right.attempts_count !== left.attempts_count) return right.attempts_count - left.attempts_count;
        return String(left.school_name).localeCompare(String(right.school_name));
      });
  }, [questionSetAttempts, schoolMap]);

  const questionRows = useMemo(() => {
    const stats = new Map();
    const schoolIds = schoolRows.map((row) => row.school_id);

    for (const question of questionSetQuestions) {
      stats.set(question.qid, {
        qid: question.qid,
        prompt: getQuestionPrompt(question),
        section: getQuestionSection(question),
        subSection: getQuestionSubSection(question),
        subSectionMultiline: formatSubSectionTwoLines(question?.metadata?.section_label || question?.metadata?.section_key || question?.question_type),
        order_index: question.order_index ?? 0,
        bySchool: Object.fromEntries(schoolIds.map((schoolId) => [schoolId, { correct: 0, total: 0 }])),
      });
    }

    for (const attempt of questionSetAttempts) {
      const answers = attempt?.answers_json ?? {};
      const schoolId = attempt?.school_id;
      if (!schoolId) continue;

      for (const question of questionSetQuestions) {
        const row = stats.get(question.qid);
        if (!row) continue;
        if (!row.bySchool[schoolId]) row.bySchool[schoolId] = { correct: 0, total: 0 };
        row.bySchool[schoolId].total += 1;
        if (isQuestionAnswerCorrect(question, answers[question.qid])) {
          row.bySchool[schoolId].correct += 1;
        }
      }
    }

    return Array.from(stats.values()).sort((left, right) => {
      if ((left.order_index ?? 0) !== (right.order_index ?? 0)) {
        return (left.order_index ?? 0) - (right.order_index ?? 0);
      }
      return String(left.qid).localeCompare(String(right.qid));
    });
  }, [questionSetAttempts, questionSetQuestions, schoolRows]);

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/super/tests/analytics"
            aria-label="Back to Analytics"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "1px solid #d0d5dd",
              color: "#101828",
              textDecoration: "none",
              background: "#fff",
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18 }}>
              <path
                d="m15 6-6 6 6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <div className="admin-title" style={{ margin: 0 }}>
            {questionSet?.title || "Question Set"}
          </div>
        </div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          {questionSet
            ? `${questionSet.test_type} • ${questionSet.visibility_scope}`
            : "Selected question set comparison."}
        </div>
        <div className="admin-form" style={{ marginTop: 12 }}>
          <div className="field small">
            <label>Date From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
          </div>
          <div className="field small">
            <label>Date To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
          </div>
          <div className="field small">
            <label>School</label>
            <select
              value={filters.schoolId}
              onChange={(event) => setFilters((prev) => ({ ...prev, schoolId: event.target.value }))}
            >
              <option value="all">All schools</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </div>
        </div>
        {msg ? <div className="admin-msg" style={{ marginTop: 12 }}>{msg}</div> : null}
      </div>

      <div className="admin-panel">
        <div className="admin-title">Selected Question Set Comparison</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Accuracy comparison for the selected question set across schools.
        </div>
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>School</th>
                <th>Attempts</th>
                <th>Avg Score</th>
              </tr>
            </thead>
            <tbody>
              {schoolRows.map((row) => (
                <tr key={row.school_id}>
                  <td>{row.school_name}</td>
                  <td>{row.attempts_count}</td>
                  <td>{formatPercent(row.avg_score)}</td>
                </tr>
              ))}
              {!loading && questionSet && schoolRows.length === 0 ? (
                <tr>
                  <td colSpan={3}>No attempts found for this question set in the selected filters.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={3}>Loading question-set comparison...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-panel">
        <div className="admin-title">Question Accuracy Comparison</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Each row is a question from the selected question set. School columns show accuracy and correct count.
        </div>
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: Math.max(960, 360 + (schoolRows.length * 160)) }}>
            <thead>
              <tr>
                <th>QID</th>
                <th>Section</th>
                <th>Sub Section</th>
                <th>Prompt</th>
                {schoolRows.map((row) => (
                  <th key={`question-school-head-${row.school_id}`}>{row.school_name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {questionRows.map((row) => (
                <tr key={row.qid}>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{row.qid}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{row.section}</td>
                  <td style={{ minWidth: 150, whiteSpace: "pre-line", lineHeight: 1.25 }}>{row.subSectionMultiline || row.subSection}</td>
                  <td style={{ minWidth: 280 }}>{row.prompt}</td>
                  {schoolRows.map((schoolRow) => {
                    const cell = row.bySchool[schoolRow.school_id] ?? { correct: 0, total: 0 };
                    const rate = cell.total ? cell.correct / cell.total : null;
                    return (
                      <td key={`question-school-cell-${row.qid}-${schoolRow.school_id}`}>
                        {cell.total ? `${formatPercent(rate)} (${cell.correct}/${cell.total})` : "N/A"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!loading && questionSet && questionRows.length === 0 ? (
                <tr>
                  <td colSpan={4 + Math.max(schoolRows.length, 1)}>No question rows found for this question set.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={4 + Math.max(schoolRows.length, 1)}>Loading question accuracy comparison...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
