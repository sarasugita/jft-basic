"use client";

import { Fragment } from "react";
import AdminConsoleDeferredFeatures from "./AdminConsoleDeferredFeatures";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderUnderlinesHtml(text) {
  const escaped = escapeHtml(text ?? "");
  return escaped
    .replace(/【(.*?)】/g, (_, inner) => (String(inner ?? "").replace(/[\s\u3000]/g, "").length
      ? `<span class="u">${inner}</span>`
      : '<span class="blank-red"></span>'))
    .replace(/［[\s\u3000]*］|\[[\s\u3000]*\]/g, '<span class="blank-red"></span>');
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

function getSectionLabelLines(label) {
  if (label === "Script and Vocabulary") return ["Script and", "Vocabulary"];
  if (label === "Reading Comprehension") return ["Reading", "Comprehension"];
  if (label === "Listening Comprehension") return ["Listening", "Comprehension"];
  if (label === "Conversation and Expression") return ["Conversation and", "Expression"];
  return String(label ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function buildSectionRadarSvg(data) {
  if (!data?.length) return null;
  const size = 300;
  const center = size / 2;
  const maxR = 96;
  const steps = 4;
  const points = data
    .map((item, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
      const r = maxR * Math.max(0, Math.min(1, Number(item?.value ?? 0)));
      const x = center + Math.cos(angle) * r;
      const y = center + Math.sin(angle) * r;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const grid = Array.from({ length: steps }, (_, index) => {
    const r = (maxR * (index + 1)) / steps;
    return <circle key={`grid-${r}`} cx={center} cy={center} r={r} className="session-radar-grid" />;
  });
  const axes = data.map((_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
    const x = center + Math.cos(angle) * maxR;
    const y = center + Math.sin(angle) * maxR;
    return <line key={`axis-${index}`} x1={center} y1={center} x2={x} y2={y} className="session-radar-axis" />;
  });
  const labels = data.map((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
    let radius = maxR + 24;
    let xOffset = 0;
    if (item.label === "Reading Comprehension") {
      radius = maxR + 10;
      xOffset = 24;
    } else if (item.label === "Conversation and Expression") {
      radius = maxR + 10;
      xOffset = -24;
    }
    const x = center + Math.cos(angle) * radius + xOffset;
    const y = center + Math.sin(angle) * radius;
    const lines = getSectionLabelLines(item.label);
    return (
      <text key={`label-${item.label}`} x={x} y={y} className="session-radar-label">
        {lines.map((line, lineIndex) => (
          <tspan key={`label-line-${item.label}-${lineIndex}`} x={x} dy={lineIndex === 0 ? "0" : "1.15em"}>
            {line}
          </tspan>
        ))}
      </text>
    );
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="session-radar-chart" role="img" aria-label="Average section performance radar chart">
      {grid}
      {axes}
      <polygon points={points} className="session-radar-shape" />
      {labels}
    </svg>
  );
}

function buildSourceQuestionKey(sourceVersion, sourceQuestionId) {
  return `${String(sourceVersion ?? "").trim()}::${String(sourceQuestionId ?? "").trim()}`;
}

function isGeneratedDailySessionVersion(version) {
  return String(version ?? "").startsWith("daily_session_");
}

export default function AdminConsoleResultsWorkspace(props) {
  const {
    supabase,
    fetchTests,
    deleteTest,
    deleteTestSession,
    closeSessionDetail,
    allowSessionAnotherAttempt,
    resultContext,
    sessionDetail,
    sessionDetailTab,
    setSessionDetailTab,
    sessionDetailQuestions,
    sessionDetailLoading,
    sessionDetailMsg,
    sessionDetailAllowStudentId,
    setSessionDetailAllowStudentId,
    sessionDetailAllowMsg,
    sessionDetailAllowances,
    sessionDetailDisplayAttempts,
    sessionDetailStudentOptions,
    sessionDetailPassRate,
    sessionDetailUsesImportedResultsSummary,
    sessionDetailUsesImportedModelSummary,
    sessionDetailAnalysisSummary,
    sessionDetailOverview,
    sessionDetailQuestionAnalysis,
    sessionDetailQuestionStudents,
    sessionDetailMainSectionAverages,
    sessionDetailNestedSectionAverages,
    sessionDetailStudentRankingRows,
    sessionDetailRankingSections,
    sessionDetailShowAllAnalysis,
    setSessionDetailShowAllAnalysis,
    sessionDetailAnalysisPopup,
    setSessionDetailAnalysisPopup,
    selectedSessionDetail,
    openAttemptDetail,
    formatDateTime,
    formatOrdinal,
    getScoreRate,
    renderTwoLineHeader,
    getSectionTitle,
    getQuestionSectionLabel,
    previewOpen,
    previewTest,
    previewSession,
    previewQuestions,
    previewReplacementPool,
    previewReplacementDrafts,
    setPreviewReplacementDrafts,
    previewReplacementSavingId,
    setPreviewReplacementSavingId,
    previewReplacementMsg,
    setPreviewReplacementMsg,
    setPreviewQuestions,
    normalizeModelCsvKind,
    splitAssetValues,
    isImageAsset,
    isAudioAsset,
  } = props;

  function closeSessionDetailAnalysisPopup() {
    setSessionDetailAnalysisPopup({ open: false, title: "", questions: [] });
  }

  function openSessionDetailAnalysisPopupFor(kind, value) {
    const label = String(value ?? "").trim();
    if (!label) return;
    const filteredQuestions = (sessionDetailQuestions ?? []).filter((question) => {
      const mainSection = getSectionTitle(question?.sectionKey) || question?.sectionKey || "Unknown";
      const subSection = getQuestionSectionLabel(question) || question?.sectionKey || "Unknown";
      if (kind === "section") return mainSection === label;
      if (kind === "subSection") return subSection === label;
      return false;
    });
    setSessionDetailAnalysisPopup({
      open: true,
      title: `${label} Questions`,
      questions: filteredQuestions,
    });
  }

  function handleSessionDetailAnalysisRowKeyDown(event, kind, value) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSessionDetailAnalysisPopupFor(kind, value);
  }

  async function replacePreviewQuestion(targetDbId) {
    if (!previewSession?.problem_set_id || !targetDbId) return;
    const nextKey = previewReplacementDrafts[targetDbId];
    if (!nextKey) {
      setPreviewReplacementMsg("Choose a replacement question first.");
      return;
    }

    const targetQuestion = previewQuestions.find((question) => question.dbId === targetDbId);
    const sourceQuestion = previewReplacementPool.find((question) =>
      buildSourceQuestionKey(question.sourceVersion || question.testVersion, question.sourceQuestionId || question.questionId) === nextKey
    );
    if (!targetQuestion || !sourceQuestion?.dbId) {
      setPreviewReplacementMsg("Replacement question was not found.");
      return;
    }

    setPreviewReplacementSavingId(targetDbId);
    setPreviewReplacementMsg("");

    const { data: sourceChoices, error: sourceChoicesError } = await supabase
      .from("choices")
      .select("part_index, choice_index, label, choice_image")
      .eq("question_id", sourceQuestion.dbId);
    if (sourceChoicesError) {
      console.error("replacement choices fetch error:", sourceChoicesError);
      setPreviewReplacementMsg(`Replacement load failed: ${sourceChoicesError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const nextData = {
      ...(sourceQuestion.rawData ?? {}),
      itemId: targetQuestion.id,
      sourceVersion: sourceQuestion.sourceVersion || sourceQuestion.testVersion || null,
      sourceQuestionId: sourceQuestion.sourceQuestionId || sourceQuestion.questionId || null,
    };

    const { error: updateQuestionError } = await supabase
      .from("questions")
      .update({
        section_key: sourceQuestion.sectionKey,
        type: sourceQuestion.type,
        prompt_en: sourceQuestion.promptEn ?? null,
        prompt_bn: sourceQuestion.promptBn ?? null,
        answer_index: sourceQuestion.answerIndex,
        data: nextData,
      })
      .eq("id", targetDbId);
    if (updateQuestionError) {
      console.error("replacement question update error:", updateQuestionError);
      setPreviewReplacementMsg(`Replace failed: ${updateQuestionError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const { error: deleteChoicesError } = await supabase
      .from("choices")
      .delete()
      .eq("question_id", targetDbId);
    if (deleteChoicesError) {
      console.error("replacement delete choices error:", deleteChoicesError);
      setPreviewReplacementMsg(`Replace failed: ${deleteChoicesError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const nextChoices = (sourceChoices ?? []).map((choice) => ({
      question_id: targetDbId,
      part_index: choice.part_index ?? null,
      choice_index: choice.choice_index,
      label: choice.label,
      choice_image: choice.choice_image,
    }));
    if (nextChoices.length) {
      const { error: insertChoicesError } = await supabase.from("choices").insert(nextChoices);
      if (insertChoicesError) {
        console.error("replacement insert choices error:", insertChoicesError);
        setPreviewReplacementMsg(`Replace failed: ${insertChoicesError.message}`);
        setPreviewReplacementSavingId("");
        return;
      }
    }

    setPreviewQuestions((current) => current.map((question) => {
      if (question.dbId !== targetDbId) return question;
      return {
        ...sourceQuestion,
        dbId: question.dbId,
        id: question.id,
        questionId: question.questionId,
        orderIndex: question.orderIndex,
        rawData: nextData,
        sourceVersion: sourceQuestion.sourceVersion || sourceQuestion.testVersion || null,
        sourceQuestionId: sourceQuestion.sourceQuestionId || sourceQuestion.questionId || null,
      };
    }));
    setPreviewReplacementDrafts((current) => ({ ...current, [targetDbId]: "" }));
    setPreviewReplacementSavingId("");
    setPreviewReplacementMsg("Question replaced.");
    fetchTests();
  }

  function QuestionPreviewCard({ question, index, children }) {
    const prompt = question.promptEn || question.promptBn || "";
    const choices = question.choices ?? question.choicesJa ?? [];
    const stemKind = normalizeModelCsvKind(question.stemKind || "");
    const stemText = question.stemText;
    const stemExtra = question.stemExtra;
    const stemAsset = question.stemAsset;
    const stemAssets = splitAssetValues(stemAsset);
    const imageAssets = stemAssets.filter((value) => isImageAsset(value));
    const audioAssets = stemAssets.filter((value) => isAudioAsset(value));
    const boxText = question.boxText;
    const isImageStem = ["image", "passage_image", "table_image"].includes(stemKind);
    const isAudioStem = stemKind === "audio";
    const shouldShowImage = imageAssets.length > 0 || (isImageStem && stemAsset);
    const shouldShowAudio = audioAssets.length > 0 || (isAudioStem && stemAsset);
    const stemLines = splitStemLines(stemExtra);
    const textBoxLines = splitTextBoxStemLines(stemExtra || stemText);
    const sectionLabel = getQuestionSectionLabel(question) || question.sectionKey;
    const displayQuestionId = String(question.sourceQuestionId ?? "").trim()
      || String(question.id ?? "").split("__").filter(Boolean)[1]
      || String(question.id ?? "").trim();

    const renderChoices = () => (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {choices.map((choice, choiceIndex) => {
          const isCorrect = question.answerIndex === choiceIndex;
          const isImage = isImageAsset(choice);
          return (
            <div
              key={`choice-${question.id}-${choiceIndex}`}
              className="btn"
              style={{
                border: isCorrect ? "2px solid #1a7f37" : "1px solid #ddd",
                background: isCorrect ? "#e7f7ee" : "#fff",
                padding: 8,
              }}
            >
              {isImage ? (
                <img src={choice} alt="choice" style={{ maxWidth: "100%" }} />
              ) : (
                choice
              )}
            </div>
          );
        })}
      </div>
    );

    return (
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>
            {displayQuestionId} {sectionLabel ? `(${sectionLabel})` : ""} {index != null ? `#${index + 1}` : ""}
          </div>
          {children ? <div style={{ display: "flex", justifyContent: "flex-end" }}>{children}</div> : null}
        </div>
        {prompt ? <div style={{ marginTop: 6, whiteSpace: question.type === "daily" ? "pre-wrap" : "normal" }}>{prompt}</div> : null}
        {question.type === "daily" && stemExtra ? (
          <div style={{ marginTop: 6, fontSize: 13, color: "#333333", whiteSpace: "pre-wrap" }}>
            {stemExtra}
          </div>
        ) : null}
        {stemText && stemKind !== "text_box" ? (
          <div
            style={{ marginTop: 6 }}
            dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(stemText) }}
          />
        ) : null}
        {stemKind === "text_box" && textBoxLines.length ? (
          <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
            {textBoxLines.map((line, lineIndex) => {
              const parsed = parseSpeakerStemLine(line);
              if (!parsed || !parsed.speaker) {
                return (
                  <div
                    key={`textbox-line-${question.id}-${lineIndex}`}
                    dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(line) }}
                  />
                );
              }
              return (
                <div
                  key={`textbox-line-${question.id}-${lineIndex}`}
                  style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: "0.45em", alignItems: "start" }}
                >
                  <span style={{ whiteSpace: "nowrap" }}>{parsed.speaker}{parsed.delimiter}</span>
                  <span dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(parsed.body) }} />
                </div>
              );
            })}
          </div>
        ) : null}
        {stemLines.length && question.type !== "daily" && stemKind !== "text_box" ? (
          <div style={{ marginTop: 6 }}>
            {stemLines.map((line, lineIndex) => (
              <div
                key={`line-${question.id}-${lineIndex}`}
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
        {shouldShowImage ? (
          imageAssets.map((asset, assetIndex) => (
            <img key={`preview-image-${question.id}-${assetIndex}`} src={asset} alt="stem" style={{ marginTop: 8, maxWidth: "100%" }} />
          ))
        ) : null}
        {shouldShowAudio ? (
          audioAssets.map((asset, assetIndex) => (
            <audio key={`preview-audio-${question.id}-${assetIndex}`} controls src={asset} style={{ marginTop: 8, width: "100%" }} />
          ))
        ) : null}

        <div style={{ marginTop: 10 }}>
          {choices.length ? renderChoices() : null}
        </div>
      </div>
    );
  }

  function renderPreviewQuestionCard(question, index) {
    const activeSourceKeys = new Set(
      previewQuestions
        .map((item) => buildSourceQuestionKey(item.sourceVersion, item.sourceQuestionId))
        .filter((key) => key !== "::")
    );
    const currentSourceKey = buildSourceQuestionKey(question.sourceVersion, question.sourceQuestionId);
    activeSourceKeys.delete(currentSourceKey);
    const replacementOptions = previewReplacementPool.filter((candidate) => {
      const candidateKey = buildSourceQuestionKey(
        candidate.sourceVersion || candidate.testVersion,
        candidate.sourceQuestionId || candidate.questionId
      );
      return candidateKey !== currentSourceKey && !activeSourceKeys.has(candidateKey);
    });
    const canReplace = Boolean(
      previewSession
      && isGeneratedDailySessionVersion(previewSession.problem_set_id)
      && replacementOptions.length
      && question.dbId
    );

    return (
      <QuestionPreviewCard key={`${question.id}-${index}`} question={question} index={index}>
        {canReplace ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value={previewReplacementDrafts[question.dbId] ?? ""}
              onChange={(e) =>
                setPreviewReplacementDrafts((current) => ({
                  ...current,
                  [question.dbId]: e.target.value,
                }))
              }
              style={{ minWidth: 260 }}
            >
              <option value="">Replace with...</option>
              {replacementOptions.map((candidate) => {
                const candidateKey = buildSourceQuestionKey(
                  candidate.sourceVersion || candidate.testVersion,
                  candidate.sourceQuestionId || candidate.questionId
                );
                return (
                  <option key={`${question.dbId}-${candidateKey}`} value={candidateKey}>
                    {(candidate.sourceVersion || candidate.testVersion)} / {(candidate.sourceQuestionId || candidate.questionId)}
                  </option>
                );
              })}
            </select>
            <button
              className="btn"
              type="button"
              disabled={previewReplacementSavingId === question.dbId}
              onClick={() => replacePreviewQuestion(question.dbId)}
            >
              {previewReplacementSavingId === question.dbId ? "Replacing..." : "Replace Question"}
            </button>
          </div>
        ) : null}
      </QuestionPreviewCard>
    );
  }

  function renderSessionDetailView() {
    if (!selectedSessionDetail) return null;
    const isMockSessionDetail = sessionDetail.type === "mock";
    const isImportedSummarySession = sessionDetailUsesImportedResultsSummary;
    const isImportedModelSummarySession = sessionDetailUsesImportedModelSummary;
    const analysisPopupQuestions = Array.isArray(sessionDetailAnalysisPopup.questions)
      ? sessionDetailAnalysisPopup.questions
      : [];

    const bestQuestions = sessionDetailQuestionAnalysis.slice(0, 5);
    const worstQuestions = [...sessionDetailQuestionAnalysis]
      .sort((a, b) => {
        if (a.rate !== b.rate) return a.rate - b.rate;
        return String(a.qid).localeCompare(String(b.qid));
      })
      .slice(0, 5);
    const sessionDetailTabs = isImportedSummarySession
      ? [
        ["analysis", "Result Analysis"],
        ["studentRanking", "Student Ranking"],
      ]
      : [
        ["analysis", "Result Analysis"],
        ["questions", "Questions"],
        ["attempts", "Attempts"],
        ["studentRanking", "Student Ranking"],
      ];
    const analysisRadarData = sessionDetailMainSectionAverages.map((row) => ({
      label: row.section,
      value: row.averageRate ?? 0,
    }));

    return (
      <div className="session-detail-page">
        <div className="session-detail-header">
          <div className="session-detail-head-main">
            <div className="session-detail-head-top">
              <button
                className="session-detail-back-btn"
                type="button"
                onClick={closeSessionDetail}
                aria-label="Back to sessions"
                title="Back to sessions"
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
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => deleteTestSession(selectedSessionDetail.id, {
                  title: selectedSessionDetail.title || selectedSessionDetail.problem_set_id,
                  type: sessionDetail.type,
                  refreshResults: true,
                  surface: "results",
                })}
              >
                Delete test
              </button>
            </div>
            <div className="admin-title session-detail-title">
              {selectedSessionDetail.title || selectedSessionDetail.problem_set_id}
            </div>
            <div className="admin-help session-detail-meta">
              {!isMockSessionDetail ? (
                <>
                  SetID: <b>{selectedSessionDetail.problem_set_id}</b>
                  {" · "}
                </>
              ) : null}
              Start: <b>{formatDateTime(selectedSessionDetail.starts_at) || "—"}</b>
              {" · "}
              End: <b>{formatDateTime(selectedSessionDetail.ends_at) || "—"}</b>
            </div>
            <div className="admin-top-tabs session-detail-tabs">
              {sessionDetailTabs.map(([key, label]) => (
                <button
                  key={`session-detail-tab-${key}`}
                  className={`admin-top-tab ${sessionDetailTab === key ? "active" : ""}`}
                  type="button"
                  onClick={() => setSessionDetailTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {sessionDetailLoading ? <div className="admin-msg">Loading...</div> : null}
        {!sessionDetailLoading && sessionDetailMsg ? <div className="admin-msg">{sessionDetailMsg}</div> : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "questions" ? (
          <div className="session-detail-section">
            <div className="admin-help">
              Total: <b>{sessionDetailQuestions.length}</b>
            </div>
            {!sessionDetailQuestions.length ? (
              <div className="admin-help" style={{ marginTop: 8 }}>No questions found for this session.</div>
            ) : (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                {sessionDetailQuestions.map((question, index) => (
                  <QuestionPreviewCard
                    key={`session-detail-question-${question.id}-${index}`}
                    question={question}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "attempts" ? (
          <div className="session-detail-section">
            <div className="session-detail-actions">
              <div>
                <div className="admin-title" style={{ fontSize: 18 }}>Allow another attempt</div>
                <div className="admin-help">
                  Select a student who already submitted this test and add one more allowed attempt.
                </div>
              </div>
              <div className="session-detail-allow-form">
                <select
                  value={sessionDetailAllowStudentId}
                  onChange={(e) => setSessionDetailAllowStudentId(e.target.value)}
                  disabled={!sessionDetailStudentOptions.length || selectedSessionDetail.allow_multiple_attempts !== false}
                >
                  {sessionDetailStudentOptions.length ? (
                    sessionDetailStudentOptions.map((student) => {
                      const extraAttempts = Number(sessionDetailAllowances[student.id] ?? 0);
                      return (
                        <option key={`session-allow-${student.id}`} value={student.id}>
                          {student.display_name}
                          {student.student_code ? ` (${student.student_code})` : ""}
                          {extraAttempts > 0 ? ` (+${extraAttempts} extra)` : ""}
                        </option>
                      );
                    })
                  ) : (
                    <option value="">No submitted students</option>
                  )}
                </select>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={allowSessionAnotherAttempt}
                  disabled={!sessionDetailAllowStudentId || selectedSessionDetail.allow_multiple_attempts !== false}
                >
                  Allow another attempt
                </button>
              </div>
            </div>
            {selectedSessionDetail.allow_multiple_attempts !== false ? (
              <div className="admin-help" style={{ marginTop: 10 }}>
                This session already allows multiple attempts for everyone.
              </div>
            ) : null}
            {sessionDetailAllowMsg ? <div className="admin-msg">{sessionDetailAllowMsg}</div> : null}

            <div className="admin-table-wrap" style={{ marginTop: 12 }}>
              <table className="admin-table" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Submitted</th>
                    <th>Name</th>
                    <th>Student<br />No.</th>
                    <th>Score</th>
                    <th>Rate</th>
                    <th>Status</th>
                    <th>Attempt ID</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionDetailDisplayAttempts.map((attempt, index) => {
                    const passed = getScoreRate(attempt) >= sessionDetailPassRate;
                    return (
                      <tr key={`session-attempt-${attempt.id}`} onClick={() => openAttemptDetail(attempt)}>
                        <td>{index + 1}</td>
                        <td>{formatDateTime(attempt.created_at)}</td>
                        <td>{attempt.display_name ?? ""}</td>
                        <td>{attempt.student_code ?? ""}</td>
                        <td>{attempt.correct}/{attempt.total}</td>
                        <td>{(getScoreRate(attempt) * 100).toFixed(1)}%</td>
                        <td className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{attempt.id}</td>
                      </tr>
                    );
                  })}
                  {!sessionDetailDisplayAttempts.length ? (
                    <tr>
                      <td colSpan={8}>No attempts yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "studentRanking" ? (
          <div className="session-detail-section">
            <div className="admin-table-wrap">
              <table className="admin-table session-student-ranking-table" style={{ minWidth: Math.max(900, 420 + sessionDetailRankingSections.length * 120) }}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    <th>Student<br />No.</th>
                    <th>Total Score</th>
                    <th>Total %</th>
                    {sessionDetailRankingSections.map((section) => (
                      <th key={`student-ranking-col-${section.section}`}>
                        <span className="session-ranking-section-header">
                          {getSectionLabelLines(section.section).map((line, index) => (
                            <span key={`student-ranking-col-${section.section}-${index}`}>{line}</span>
                          ))}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessionDetailStudentRankingRows.map((row) => (
                    <tr key={`student-ranking-row-${row.student_id}`} onClick={() => openAttemptDetail(row.attempt, "sessionRanking")}>
                      <td>{formatOrdinal(row.rank)}</td>
                      <td>{row.display_name}</td>
                      <td>{row.student_code || "—"}</td>
                      <td>{row.totalCorrect}/{row.totalQuestions}</td>
                      <td>{(row.totalRate * 100).toFixed(1)}%</td>
                      {sessionDetailRankingSections.map((section) => (
                        <td key={`student-ranking-cell-${row.student_id}-${section.section}`}>
                          {((row.sectionRates?.[section.section] ?? 0) * 100).toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!sessionDetailStudentRankingRows.length ? (
                    <tr>
                      <td colSpan={Math.max(5, 5 + sessionDetailRankingSections.length)}>No ranking data available.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "analysis" ? (
          <div className="session-detail-section">
            <div className="session-detail-analysis-summary">
              <div className="session-analysis-top-grid">
                <div className="session-analysis-top-card">
                  <div className="session-analysis-top-heading">Class Score</div>
                  <div className="session-analysis-score-table-wrap">
                    <table className="session-analysis-score-table">
                      <tbody>
                        <tr>
                          <th className="pass">No. of Pass</th>
                          <td>
                            <span className="session-analysis-score-main pass">{sessionDetailAnalysisSummary.passCount}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.attendedCount}</span>
                          </td>
                        </tr>
                        <tr>
                          <th className="fail">No. of Fail</th>
                          <td>
                            <span className="session-analysis-score-main fail">{sessionDetailAnalysisSummary.failCount}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.attendedCount}</span>
                          </td>
                        </tr>
                        <tr>
                          <th>Average score</th>
                          <td>
                            <span className="session-analysis-score-main">{sessionDetailAnalysisSummary.averageCorrect.toFixed(2)}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.totalQuestions || 0}</span>
                          </td>
                        </tr>
                        <tr>
                          <th>Average %</th>
                          <td>
                            <span className={`session-analysis-score-main ${sessionDetailOverview.averageScore < sessionDetailPassRate ? "fail" : ""}`}>
                              {(sessionDetailAnalysisSummary.averageRate * 100).toFixed(2)}%
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <th>Absent</th>
                          <td>
                            <span className="session-analysis-score-main">{sessionDetailAnalysisSummary.absentCount}</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="session-analysis-top-card">
                  <div className="session-analysis-top-heading">Grade Distribution</div>
                  <div className="session-analysis-distribution-chart">
                    <div className="session-analysis-distribution-yaxis">
                      {Array.from({ length: Math.max(1, sessionDetailAnalysisSummary.maxBucketCount + 1) }, (_, index) => {
                        const value = sessionDetailAnalysisSummary.maxBucketCount - index;
                        return (
                          <div key={`dist-y-${value}`} className="session-analysis-distribution-ytick">
                            <span>{value}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="session-analysis-distribution-plot">
                      <div
                        className="session-analysis-distribution-grid"
                        style={{ gridTemplateRows: `repeat(${Math.max(1, sessionDetailAnalysisSummary.maxBucketCount + 1)}, 1fr)` }}
                      >
                        {Array.from({ length: Math.max(1, sessionDetailAnalysisSummary.maxBucketCount + 1) }, (_, index) => (
                          <div key={`dist-grid-${index}`} className="session-analysis-distribution-gridline" />
                        ))}
                      </div>
                      <div className="session-analysis-distribution-bars">
                        {sessionDetailAnalysisSummary.bucketLabels.map((label, index) => {
                          const count = sessionDetailAnalysisSummary.bucketCounts[index] ?? 0;
                          const maxCount = Math.max(1, sessionDetailAnalysisSummary.maxBucketCount);
                          return (
                            <div key={`dist-bar-${label}`} className="session-analysis-distribution-bar-group">
                              <div className="session-analysis-distribution-bar-wrap">
                                <div
                                  className={`session-analysis-distribution-bar ${index * 10 < sessionDetailPassRate * 100 ? "fail" : "pass"}`}
                                  style={{ height: `${(count / maxCount) * 100}%` }}
                                  title={`${label}: ${count} student${count === 1 ? "" : "s"}`}
                                />
                              </div>
                              <div className="session-analysis-distribution-label">{label}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {isMockSessionDetail && (isImportedModelSummarySession || sessionDetailNestedSectionAverages.length) ? (
                <div className="admin-panel session-analysis-performance-panel">
                  <div className="admin-title" style={{ fontSize: 18 }}>Average Section Performance</div>
                  <div className="session-analysis-summary-grid">
                    <div className="session-radar-wrap">
                      {analysisRadarData.length ? (
                        buildSectionRadarSvg(analysisRadarData)
                      ) : (
                        <div className="admin-help">No section average data yet.</div>
                      )}
                    </div>
                    <div className="admin-table-wrap">
                      {isImportedModelSummarySession ? (
                        <table className="admin-table session-section-average-table" style={{ minWidth: 520 }}>
                          <thead>
                            <tr>
                              <th>Section</th>
                              <th>Total</th>
                              <th>Average</th>
                              <th>Average %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sessionDetailMainSectionAverages.map((row) => {
                              const isBelowPass = row.averageRate < sessionDetailPassRate;
                              return (
                                <tr key={`session-average-main-${row.section}`}>
                                  <td><span className="session-ranking-section-header">{renderTwoLineHeader(row.section)}</span></td>
                                  <td>{row.total}</td>
                                  <td className={isBelowPass ? "attempt-score-detail-below-pass" : ""}>
                                    {row.averageCorrect.toFixed(2)}
                                  </td>
                                  <td className={isBelowPass ? "attempt-score-detail-below-pass" : ""}>
                                    {(row.averageRate * 100).toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                            {!sessionDetailMainSectionAverages.length ? (
                              <tr>
                                <td colSpan={4}>No section average data yet.</td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      ) : (
                        <table className="admin-table session-section-average-table" style={{ minWidth: 640 }}>
                          <colgroup>
                            <col className="session-section-average-col-section" />
                            <col className="session-section-average-col-subsection" />
                            <col className="session-section-average-col-total" />
                            <col className="session-section-average-col-correct" />
                            <col className="session-section-average-col-rate" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="session-section-average-head-section">Section</th>
                              <th className="session-section-average-head-subsection">Sub-section</th>
                              <th className="session-section-average-head-total">Total</th>
                              <th className="session-section-average-head-correct">Average</th>
                              <th className="session-section-average-head-rate">Average %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sessionDetailNestedSectionAverages.map((group) => {
                              const rowSpan = 1 + group.subSections.length;
                              const isGroupBelowPass = group.averageRate < sessionDetailPassRate;
                              return (
                                <Fragment key={`session-average-group-${group.mainSection}`}>
                                  <tr className="attempt-overview-total-row session-section-average-total-row">
                                    <td rowSpan={rowSpan} className="attempt-overview-area-cell session-section-average-cell-section">
                                      <button
                                        type="button"
                                        className="session-section-average-trigger session-section-average-section-trigger"
                                        onClick={() => openSessionDetailAnalysisPopupFor("section", group.mainSection)}
                                      >
                                        <span className="session-ranking-section-header">{renderTwoLineHeader(group.mainSection)}</span>
                                      </button>
                                    </td>
                                    <td className="session-section-average-cell-subsection">
                                      <button
                                        type="button"
                                        className="session-section-average-trigger session-section-average-total-trigger"
                                        onClick={() => openSessionDetailAnalysisPopupFor("section", group.mainSection)}
                                      >
                                        <span className="attempt-score-detail-total-label">Total</span>
                                      </button>
                                    </td>
                                    <td className="session-section-average-cell-total">{group.total}</td>
                                    <td className={`session-section-average-cell-correct ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                      {group.averageCorrect.toFixed(2)}
                                    </td>
                                    <td className={`session-section-average-cell-rate ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                      {(group.averageRate * 100).toFixed(1)}%
                                    </td>
                                  </tr>
                                  {group.subSections.map((subSection) => {
                                    const isSubSectionBelowPass = subSection.averageRate < sessionDetailPassRate;
                                    return (
                                      <tr
                                        key={`session-average-sub-${group.mainSection}-${subSection.section}`}
                                        className="session-section-average-subsection-row"
                                        onClick={() => openSessionDetailAnalysisPopupFor("subSection", subSection.section)}
                                        onKeyDown={(event) => handleSessionDetailAnalysisRowKeyDown(event, "subSection", subSection.section)}
                                        tabIndex={0}
                                        role="button"
                                      >
                                        <td className="session-section-average-cell-subsection">{subSection.section}</td>
                                        <td className="session-section-average-cell-total">{subSection.total}</td>
                                        <td className={`session-section-average-cell-correct ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                          {subSection.averageCorrect.toFixed(2)}
                                        </td>
                                        <td className={`session-section-average-cell-rate ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                          {(subSection.averageRate * 100).toFixed(1)}%
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {!isImportedSummarySession ? (
              <>
                <div className="session-detail-analysis-grid">
                  <div className="admin-panel">
                    <div className="session-analysis-heading">Top 5 Best Questions</div>
                    <div className="session-analysis-list">
                      {bestQuestions.map((row) => (
                        <div key={`best-${row.qid}`} className="session-analysis-item">
                          <div className="session-analysis-rate">{(row.rate * 100).toFixed(1)}%</div>
                          <div>
                            <div className="session-analysis-title">{row.qid}</div>
                            <div className="admin-help">{row.prompt}</div>
                          </div>
                        </div>
                      ))}
                      {!bestQuestions.length ? <div className="admin-help">No question data yet.</div> : null}
                    </div>
                  </div>

                  <div className="admin-panel">
                    <div className="session-analysis-heading">Top 5 Worst Questions</div>
                    <div className="session-analysis-list">
                      {worstQuestions.map((row) => (
                        <div key={`worst-${row.qid}`} className="session-analysis-item">
                          <div className="session-analysis-rate">{(row.rate * 100).toFixed(1)}%</div>
                          <div>
                            <div className="session-analysis-title">{row.qid}</div>
                            <div className="admin-help">{row.prompt}</div>
                          </div>
                        </div>
                      ))}
                      {!worstQuestions.length ? <div className="admin-help">No question data yet.</div> : null}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => setSessionDetailShowAllAnalysis((current) => !current)}
                  >
                    {sessionDetailShowAllAnalysis ? "Hide all v" : "View all ->"}
                  </button>
                </div>

                {sessionDetailShowAllAnalysis ? (
                  <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                    <table className="admin-table session-analysis-table" style={{ minWidth: 1100 }}>
                      <thead>
                        <tr>
                          <th>Question</th>
                          <th>Accuracy</th>
                          {sessionDetailQuestionStudents.map((student) => (
                            <th key={`analysis-student-${student.id}`}>
                              <div>{student.display_name}</div>
                              {student.student_code ? (
                                <div className="session-analysis-student-code">{student.student_code}</div>
                              ) : null}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sessionDetailQuestionAnalysis.map((row) => (
                          <tr key={`analysis-row-${row.qid}`}>
                            <td>
                              <div style={{ fontWeight: 800 }}>{row.qid}</div>
                              <div className="admin-help">{row.prompt}</div>
                            </td>
                            <td>{(row.rate * 100).toFixed(1)}%</td>
                            {sessionDetailQuestionStudents.map((student) => {
                              const status = row.byStudent[student.id];
                              return (
                                <td key={`analysis-cell-${row.qid}-${student.id}`} className="session-analysis-cell">
                                  {status == null ? "—" : status ? "○" : "×"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {!sessionDetailQuestionAnalysis.length ? (
                          <tr>
                            <td colSpan={Math.max(2, sessionDetailQuestionStudents.length + 2)}>No question analysis available.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {sessionDetailAnalysisPopup.open ? (
          <div className="admin-modal-overlay" onClick={closeSessionDetailAnalysisPopup}>
            <div className="admin-modal admin-modal-wide session-analysis-popup-modal" onClick={(event) => event.stopPropagation()}>
              <div className="admin-modal-header">
                <div>
                  <div className="admin-title">{sessionDetailAnalysisPopup.title || "Questions"}</div>
                  <div className="admin-help">
                    Total: <b>{analysisPopupQuestions.length}</b>
                  </div>
                </div>
                <button className="admin-modal-close" onClick={closeSessionDetailAnalysisPopup} aria-label="Close">
                  ×
                </button>
              </div>
              <div className="session-analysis-popup-body">
                {analysisPopupQuestions.length ? (
                  analysisPopupQuestions.map((question, index) => (
                    <QuestionPreviewCard
                      key={`session-analysis-popup-${question.id}-${index}`}
                      question={question}
                      index={index}
                    />
                  ))
                ) : (
                  <div className="admin-help">No questions found for this selection.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <AdminConsoleDeferredFeatures
      {...props}
      deleteTest={deleteTest}
      renderSessionDetailView={renderSessionDetailView}
      renderPreviewQuestionCard={renderPreviewQuestionCard}
      buildSectionRadarSvg={buildSectionRadarSvg}
      renderUnderlinesHtml={renderUnderlinesHtml}
    />
  );
}
