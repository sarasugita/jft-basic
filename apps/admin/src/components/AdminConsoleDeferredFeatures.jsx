"use client";

import { Fragment } from "react";
import { createPortal } from "react-dom";

function formatAttemptDetailDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year ?? ""}-${parts.month ?? ""}-${parts.day ?? ""} ${parts.hour ?? ""}:${parts.minute ?? ""}`.trim();
}

export default function AdminConsoleDeferredFeatures({
  resultContext,
  sessionDetail,
  renderSessionDetailView,
  dailyResultCategories,
  modelResultCategories,
  modelResultsCategory,
  selectedDailyCategory,
  selectedModelCategory,
  setDailyResultsCategory,
  setModelResultsCategory,
  runSearch,
  exportDailyGoogleSheetsCsv,
  exportModelGoogleSheetsCsv,
  openResultsImportStatus,
  dailyManualEntryMode,
  setDailyManualEntryMode,
  clearDailyResultsForCategory,
  resultsImportInputRef,
  resultsImportStatus,
  getResultsImportTargetCategoryName,
  importDailyResultsGoogleSheetsCsv,
  importModelResultsGoogleSheetsCsv,
  quizMsg,
  dailyResultsMatrix,
  modelResultsMatrix,
  dailyResultsSessionHeaderAverages,
  modelResultsSessionHeaderAverages,
  dailyResultsSessionDetailAvailability,
  modelResultsSessionDetailAvailability,
  openSessionDetailView,
  isImportedSummaryAttempt,
  openDailyManualEntryModal,
  getSessionEffectivePassRate,
  expandedResultCells,
  setExpandedResultCells,
  getScoreRate,
  getTabLeftCount,
  attemptCanOpenDetail,
  openAttemptDetail,
  loading,
  msg,
  applyTestFilter,
  filters,
  setFilters,
  kpi,
  attempts,
  formatDateTime,
  exportSelectedAttemptCsv,
  deleteTest,
  deleteAttempt,
  formatDateShort,
  previewOpen,
  closePreview,
  previewTest,
  previewSession,
  previewQuestions,
  previewMsg,
  previewReplacementMsg,
  isModelPreview,
  previewSectionTitles,
  previewSectionRefs,
  previewSectionBreaks,
  renderPreviewQuestionCard,
  previewDisplayQuestions,
  attemptDetailOpen,
  selectedAttempt,
  selectedAttemptDisplayName,
  selectedAttemptRows,
  selectedAttemptScoreRate,
  getAttemptTitle,
  studentAttemptRanks,
  attemptDetailSource,
  selectedAttemptUsesImportedSummary,
  selectedAttemptUsesImportedModelSummary,
  selectedAttemptMainSectionSummary,
  setAttemptDetailOpen,
  setSelectedAttemptObj,
  setAttemptDetailSource,
  attemptQuestionsLoading,
  attemptQuestionsError,
  attemptDetailTab,
  setAttemptDetailTab,
  selectedAttemptIsPass,
  selectedAttemptIsModel,
  buildSectionRadarSvg,
  selectedAttemptNestedSectionSummary,
  selectedAttemptPassRate,
  renderTwoLineHeader,
  selectedAttemptSectionSummary,
  selectedAttemptQuestionSectionsFiltered,
  attemptDetailSectionRefs,
  attemptDetailWrongOnly,
  setAttemptDetailWrongOnly,
  renderUnderlinesHtml,
}) {
  const canAttemptOpenDetail = (attempt) => (
    typeof attemptCanOpenDetail === "function"
      && typeof openAttemptDetail === "function"
      && attemptCanOpenDetail(attempt)
  );

  return (
    <>
      {resultContext ? (
        <>
          {sessionDetail.type === resultContext.type && sessionDetail.sessionId ? (
            renderSessionDetailView()
          ) : (
            <>
              <div className="results-page-header">
                <div className="results-page-header-row">
                  {(resultContext.type === "daily" ? dailyResultCategories : modelResultCategories).length ? (
                    <div className="admin-mini-tabs results-category-tabs">
                      {resultContext.type === "mock" ? (
                        <button
                          key="model-cat-all"
                          className={`admin-mini-tab results-category-tab ${!modelResultsCategory ? "active" : ""}`}
                          onClick={() => setModelResultsCategory("")}
                        >
                          All
                        </button>
                      ) : null}
                      {(resultContext.type === "daily" ? dailyResultCategories : modelResultCategories).map((c) => (
                        <button
                          key={`daily-cat-${c.name}`}
                          className={`admin-mini-tab results-category-tab ${((resultContext.type === "daily"
                            ? selectedDailyCategory
                            : selectedModelCategory)?.name === c.name)
                            ? "active"
                            : ""}`}
                          onClick={() => {
                            if (resultContext.type === "daily") {
                              setDailyResultsCategory(c.name);
                            } else {
                              setModelResultsCategory(c.name);
                            }
                          }}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  ) : <div />}
                  <div className="results-page-title-wrap">
                    <div className="admin-title">{resultContext.title}</div>
                  </div>
                  <div className="results-page-actions">
                    <button
                      className="btn admin-icon-action-btn"
                      aria-label="Refresh results"
                      title="Refresh results"
                      onClick={() => runSearch(resultContext.type)}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path
                          d="M16 10a6 6 0 1 1-1.76-4.24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                        <path
                          d="M16 4.5v3.75h-3.75"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      className="btn results-page-action-btn"
                      onClick={() => (resultContext.type === "daily" ? exportDailyGoogleSheetsCsv() : exportModelGoogleSheetsCsv())}
                    >
                      <span className="results-page-action-icon" aria-hidden="true">↓</span>
                      <span>Export CSV</span>
                    </button>
                    <button
                      className="btn results-page-action-btn"
                      type="button"
                      onClick={() => openResultsImportStatus(resultContext.type)}
                    >
                      <span className="results-page-action-icon" aria-hidden="true">↑</span>
                      <span>Import CSV</span>
                    </button>
                    {resultContext.type === "daily" ? (
                      <button
                        className={`btn results-page-action-btn ${dailyManualEntryMode ? "active" : ""}`}
                        type="button"
                        onClick={() => setDailyManualEntryMode((current) => !current)}
                        disabled={!selectedDailyCategory}
                      >
                        <span className="results-page-action-icon" aria-hidden="true">M</span>
                        <span>{dailyManualEntryMode ? "Manual Entry On" : "Manual Entry"}</span>
                      </button>
                    ) : null}
                    {resultContext.type === "daily" ? (
                      <button
                        className="btn btn-danger results-page-action-btn"
                        type="button"
                        onClick={() => clearDailyResultsForCategory(selectedDailyCategory)}
                        disabled={!selectedDailyCategory}
                      >
                        <span>Clear All Results</span>
                      </button>
                    ) : null}
                    <input
                      ref={resultsImportInputRef}
                      type="file"
                      accept=".csv,.tsv"
                      style={{ display: "none" }}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        const importType = resultsImportStatus?.type || resultContext.type;
                        const targetCategoryName = getResultsImportTargetCategoryName();
                        if (importType === "daily") {
                          importDailyResultsGoogleSheetsCsv(file, targetCategoryName);
                          return;
                        }
                        importModelResultsGoogleSheetsCsv(file, targetCategoryName);
                      }}
                    />
                  </div>
                </div>
                {quizMsg ? <div className="admin-help">{quizMsg}</div> : null}
                {resultContext.type === "daily" && dailyManualEntryMode ? (
                  <div className="admin-help" style={{ marginTop: 6 }}>
                    Manual entry mode is on. Click an empty cell to add a score, or click an imported summary cell to update it. Cells with real submitted attempts stay read-only.
                  </div>
                ) : null}
              </div>

              {resultContext.type === "daily" || resultContext.type === "mock" ? (
                <>
                  {!(resultContext.type === "daily" ? dailyResultCategories : modelResultCategories).length ? (
                    <div className="admin-msg">No test categories yet.</div>
                  ) : null}

                  <div className="admin-table-wrap results-matrix-table-wrap" style={{ marginTop: 10 }}>
                    <table
                      className={`admin-table daily-results-table ${resultContext.type === "mock" ? "model-results-matrix-table" : ""}`}
                      style={{
                        minWidth: Math.max(
                          860,
                          360 + ((resultContext.type === "daily"
                            ? dailyResultsMatrix.sessions.length
                            : modelResultsMatrix.sessions.length) || 0) * 140
                        )
                      }}
                    >
                      <thead>
                        <tr>
                          <th className="daily-sticky-1 daily-col-no">Student<br />No.</th>
                          <th className="daily-sticky-2 daily-col-name">Student Name</th>
                          {(resultContext.type === "daily" ? dailyResultsMatrix.sessions : modelResultsMatrix.sessions).map((sessionItem, sessionIndex) => {
                            const activeMatrix = resultContext.type === "daily" ? dailyResultsMatrix : modelResultsMatrix;
                            const precomputedSessionAverage = (resultContext.type === "daily"
                              ? dailyResultsSessionHeaderAverages
                              : modelResultsSessionHeaderAverages)[sessionItem.id] ?? null;
                            const visibleAttempts = (activeMatrix.rows ?? [])
                              .filter((row) => !row?.student?.is_withdrawn && !row?.student?.is_test_account)
                              .map((row) => row?.cells?.[sessionIndex]?.[0] ?? null)
                              .filter(Boolean);
                            const sessionAverage = visibleAttempts.length
                              ? {
                                  averageRate: visibleAttempts.reduce((sum, attempt) => sum + getScoreRate(attempt), 0) / visibleAttempts.length,
                                }
                              : precomputedSessionAverage;
                            return (
                              <th key={`daily-col-${sessionItem.id}`}>
                                {((resultContext.type === "daily"
                                  ? dailyResultsSessionDetailAvailability
                                  : modelResultsSessionDetailAvailability)[sessionItem.id]) ? (
                                  <button
                                    type="button"
                                    className="session-column-link"
                                    onClick={() => openSessionDetailView(sessionItem, resultContext.type)}
                                  >
                                    <div className="daily-col-title">{sessionItem.title ?? sessionItem.problem_set_id ?? ""}</div>
                                    <div className="daily-col-date">{formatDateShort(sessionItem.starts_at || sessionItem.created_at)}</div>
                                    <div className="daily-col-average">
                                      Avg {(((sessionAverage?.averageRate ?? 0) * 100)).toFixed(1)}%
                                    </div>
                                  </button>
                                ) : (
                                  <div className="session-column-link" style={{ cursor: "default" }}>
                                    <div className="daily-col-title">{sessionItem.title ?? sessionItem.problem_set_id ?? ""}</div>
                                    <div className="daily-col-date">{formatDateShort(sessionItem.starts_at || sessionItem.created_at)}</div>
                                    <div className="daily-col-average">
                                      Avg {(((sessionAverage?.averageRate ?? 0) * 100)).toFixed(1)}%
                                    </div>
                                  </div>
                                )}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {(resultContext.type === "daily" ? dailyResultsMatrix.rows : modelResultsMatrix.rows)
                          .filter((row) => !row.student.is_withdrawn)
                          .map((row) => (
                            <tr key={`daily-row-${row.student.id}`}>
                              <td className="daily-sticky-1 daily-col-no">{row.student.student_code ?? ""}</td>
                              <td className="daily-sticky-2 daily-col-name">
                                <div className="student-list-name-cell">
                                  {row.student.is_test_account ? (
                                    <span className="student-test-account-badge" title="Test Account" aria-label="Test Account">
                                      T
                                    </span>
                                  ) : null}
                                  <div className="daily-name">{row.student.display_name ?? ""}</div>
                                </div>
                              </td>
                              {row.cells.map((attemptList, idx) => {
                                const sessionItem = (resultContext.type === "daily"
                                  ? dailyResultsMatrix.sessions
                                  : modelResultsMatrix.sessions)[idx];
                                const canEditManualCell = resultContext.type === "daily"
                                  && dailyManualEntryMode
                                  && Array.isArray(attemptList)
                                  && attemptList.every((attempt) => isImportedSummaryAttempt(attempt));
                                const editableImportedAttempt = attemptList?.find((attempt) => isImportedSummaryAttempt(attempt)) ?? null;
                                if (!attemptList?.length) {
                                  return (
                                    <td key={`daily-cell-${row.student.id}-${idx}`} className="daily-score-cell">
                                      {resultContext.type === "daily" && dailyManualEntryMode ? (
                                        <button
                                          className="daily-manual-cell-btn"
                                          type="button"
                                          onClick={() => openDailyManualEntryModal(row.student, sessionItem, [])}
                                        >
                                          Add result
                                        </button>
                                      ) : "—"}
                                    </td>
                                  );
                                }
                                const passRate = getSessionEffectivePassRate(sessionItem, attemptList);
                                const cellKey = `${row.student.id}:${sessionItem.id}`;
                                const extraAttempts = attemptList.slice(1);
                                const visibleAttempts = expandedResultCells[cellKey] ? attemptList : attemptList.slice(0, 1);
                                return (
                                  <td
                                    key={`daily-cell-${row.student.id}-${idx}`}
                                    className="daily-score-cell"
                                  >
                                    <div className="daily-score-stack">
                                      {visibleAttempts.map((attempt, attemptIdx) => {
                                        const rateValue = getScoreRate(attempt);
                                        const label = `${(rateValue * 100).toFixed(1)}%`;
                                        const isLow = Number.isFinite(passRate) && passRate > 0 && rateValue < passRate;
                                        const tabLeftCount = getTabLeftCount(attempt);
                                        const scoreContent = (
                                          <>
                                            <span className="daily-score-main">
                                              {attempt.__isRetake ? <span className="daily-retake-icon">Re</span> : null}
                                              <span>{label}</span>
                                            </span>
                                            {tabLeftCount > 0 ? (
                                              <span className="daily-score-meta daily-score-meta-alert">
                                                Tabs left: {tabLeftCount}
                                              </span>
                                            ) : null}
                                          </>
                                        );
                                        if (!canAttemptOpenDetail(attempt)) {
                                          return (
                                            <div
                                              key={`daily-cell-${row.student.id}-${idx}-${attempt.id || attemptIdx}`}
                                              className={`daily-score-btn ${isLow ? "low" : ""}`}
                                            >
                                              {scoreContent}
                                            </div>
                                          );
                                        }
                                        return (
                                          <button
                                            key={`daily-cell-${row.student.id}-${idx}-${attempt.id || attemptIdx}`}
                                            className={`daily-score-btn ${isLow ? "low" : ""}`}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openAttemptDetail(attempt);
                                            }}
                                          >
                                            {scoreContent}
                                          </button>
                                        );
                                      })}
                                      {extraAttempts.length ? (
                                        <button
                                          className="daily-more-btn"
                                          type="button"
                                          onClick={() => {
                                            setExpandedResultCells((prev) => ({
                                              ...prev,
                                              [cellKey]: !prev[cellKey],
                                            }));
                                          }}
                                        >
                                          {expandedResultCells[cellKey]
                                            ? "Hide extra attempts"
                                            : `${extraAttempts.length} more attempt${extraAttempts.length > 1 ? "s" : ""}`}
                                        </button>
                                      ) : null}
                                      {canEditManualCell ? (
                                        <button
                                          className="daily-manual-cell-btn"
                                          type="button"
                                          onClick={() => openDailyManualEntryModal(row.student, sessionItem, attemptList)}
                                        >
                                          {editableImportedAttempt ? "Edit manual result" : "Add result"}
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-msg">{loading ? "Loading..." : msg}</div>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div className="admin-title">Tests</div>
                      </div>
                      <button className="btn" onClick={() => applyTestFilter("", resultContext.type)}>Clear Filter</button>
                    </div>
                    {filters.testVersion ? (
                      <div className="admin-help" style={{ marginTop: 6 }}>
                        Filter: <b>{filters.testVersion}</b>
                      </div>
                    ) : null}
                    <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                      <table className="admin-table" style={{ minWidth: 860 }}>
                        <thead>
                          <tr>
                            <th>Created</th>
                            <th>SetID</th>
                            <th>Category</th>
                            <th>Questions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultContext.tests.map((t) => (
                            <tr key={`result-test-${t.id}`} onClick={() => applyTestFilter(t.version, resultContext.type)}>
                              <td>{formatDateTime(t.created_at)}</td>
                              <td>{t.version ?? ""}</td>
                              <td>{t.title ?? ""}</td>
                              <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <form
                    className="admin-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      runSearch(resultContext.type);
                    }}
                  >
                    <div className="field">
                      <label>Student No.（partial match）</label>
                      <input
                        placeholder="ID001"
                        value={filters.code}
                        onChange={(e) => setFilters((s) => ({ ...s, code: e.target.value }))}
                      />
                    </div>
                    <div className="field">
                      <label>Display Name（部分一致）</label>
                      <input
                        placeholder="Taro"
                        value={filters.name}
                        onChange={(e) => setFilters((s) => ({ ...s, name: e.target.value }))}
                      />
                    </div>
                    <div className="field small">
                      <label>From（created_at）</label>
                      <input
                        type="date"
                        value={filters.from}
                        onChange={(e) => setFilters((s) => ({ ...s, from: e.target.value }))}
                      />
                    </div>
                    <div className="field small">
                      <label>To（created_at）</label>
                      <input
                        type="date"
                        value={filters.to}
                        onChange={(e) => setFilters((s) => ({ ...s, to: e.target.value }))}
                      />
                    </div>
                    <div className="field small">
                      <label>Limit</label>
                      <select
                        value={filters.limit}
                        onChange={(e) => setFilters((s) => ({ ...s, limit: Number(e.target.value) }))}
                      >
                        <option value={50}>50</option>
                        <option value={200}>200</option>
                        <option value={500}>500</option>
                        <option value={1000}>1000</option>
                      </select>
                    </div>
                    <div className="field small">
                      <label>&nbsp;</label>
                      <button className="btn btn-primary" type="submit">Search</button>
                    </div>
                  </form>

                  <div className="admin-kpi">
                    <div className="box">
                      <div className="label">Attempts</div>
                      <div className="value">{kpi.count}</div>
                    </div>
                    <div className="box">
                      <div className="label">Avg rate</div>
                      <div className="value">{(kpi.avgRate * 100).toFixed(1)}%</div>
                    </div>
                    <div className="box">
                      <div className="label">Max rate</div>
                      <div className="value">{(kpi.maxRate * 100).toFixed(1)}%</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }} className="admin-table-wrap">
                    <table className="admin-table admin-model-results-table">
                      <thead>
                        <tr>
                          <th>Created</th>
                          <th>Name</th>
                          <th>Student<br />No.</th>
                          <th>Score</th>
                          <th>Rate</th>
                          <th>Test</th>
                          <th>Attempt ID</th>
                          <th>Detail CSV</th>
                          <th>Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts.map((a) => {
                          const score = `${a.correct}/${a.total}`;
                          const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                          return (
                            <tr key={a.id}>
                              <td>
                                <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                  {formatDateTime(a.created_at)}
                                </button>
                              </td>
                              <td>{a.display_name ?? ""}</td>
                              <td>{a.student_code ?? ""}</td>
                              <td>
                                <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                  {score}
                                </button>
                              </td>
                              <td>
                                <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                  {rate}
                                </button>
                              </td>
                              <td>
                                <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                  {a.test_version ?? ""}
                                </button>
                              </td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                  {a.id}
                                </button>
                              </td>
                              <td>
                                <button
                                  className="btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    exportSelectedAttemptCsv(a);
                                  }}
                                >
                                  Download
                                </button>
                              </td>
                              <td>
                                <button
                                  className="btn btn-danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteAttempt(a.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-msg">{loading ? "Loading..." : msg}</div>
                </>
              )}
            </>
          )}
        </>
      ) : null}

      {previewOpen && typeof document !== "undefined" ? createPortal((
        <div className="admin-modal-overlay" onClick={closePreview}>
          <div
            className="admin-modal admin-modal-wide daily-session-create-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header daily-session-create-header">
              <div className="admin-title">
                {previewSession ? previewSession.title || previewSession.problem_set_id : previewTest || "Preview"}
              </div>
              <button
                className="admin-modal-close"
                onClick={closePreview}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="daily-session-create-body">
              <div className="admin-help">
                Total: <b>{previewQuestions.length}</b> questions
              </div>
              {previewMsg ? <div className="admin-msg">{previewMsg}</div> : null}
              {previewReplacementMsg ? <div className="admin-msg">{previewReplacementMsg}</div> : null}
              {!previewMsg && previewQuestions.length === 0 ? (
                <div className="admin-help" style={{ marginTop: 6 }}>
                  No questions. Upload & Register SetでCSVを取り込むか、CSVの`test_version`がこのセットと一致しているか確認してください。
                </div>
              ) : null}

              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
                {isModelPreview && previewSectionTitles.length ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {previewSectionTitles.map((sectionTitle) => (
                      <button
                        key={`preview-jump-${sectionTitle}`}
                        className="btn"
                        type="button"
                        onClick={() => previewSectionRefs.current[sectionTitle]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      >
                        {sectionTitle}
                      </button>
                    ))}
                  </div>
                ) : null}
                {isModelPreview ? (
                  previewSectionBreaks.map(({ question, index, sectionTitle, showHeader }) => (
                    <Fragment key={`preview-section-row-${question.id}-${index}`}>
                      {showHeader ? (
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
                      {renderPreviewQuestionCard(question, index)}
                    </Fragment>
                  ))
                ) : (
                  previewDisplayQuestions.map((question, index) => renderPreviewQuestionCard(question, index))
                )}
              </div>
            </div>
          </div>
        </div>
      ), document.body) : null}

      {attemptDetailOpen && selectedAttempt && typeof document !== "undefined" ? (() => {
        const totalCorrect = Number(selectedAttempt.correct ?? selectedAttemptRows.filter((row) => row.isCorrect).length);
        const totalQuestions = Number(selectedAttempt.total ?? selectedAttemptRows.length);
        const scorePercent = (selectedAttemptScoreRate * 100).toFixed(1);
        const attemptTitle = getAttemptTitle(selectedAttempt) || selectedAttempt.test_version || "";
        const tabLeftCount = getTabLeftCount(selectedAttempt);
        const selectedAttemptRankInfo = studentAttemptRanks[selectedAttempt.id] ?? null;
        const attemptStudentName = selectedAttemptDisplayName || selectedAttempt.display_name || "";
        const showSummaryOnly = selectedAttemptUsesImportedSummary;
        const showRankingMainSectionsOnly = attemptDetailSource === "sessionRanking" || selectedAttemptUsesImportedModelSummary;
        const radarData = selectedAttemptMainSectionSummary.map((row) => ({
          label: row.section,
          value: row.total ? row.correct / row.total : 0,
        }));
        const closeAttemptDetail = () => {
          setAttemptDetailOpen(false);
          setSelectedAttemptObj(null);
          setAttemptDetailSource("default");
        };

        return createPortal((
          <div
            className="admin-modal-overlay"
            onClick={closeAttemptDetail}
          >
            <div
              className="admin-modal admin-modal-wide daily-session-create-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="admin-modal-header daily-session-create-header">
                <div className="admin-title">Attempt Detail</div>
                <button
                  className="admin-modal-close"
                  onClick={closeAttemptDetail}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="daily-session-create-body">
              <div className="attempt-detail-top">
                <div className="attempt-detail-summary-card">
                  <table className="attempt-detail-summary-table">
                    <tbody>
                      <tr>
                        <th>Student Name</th>
                        <td>{attemptStudentName}</td>
                      </tr>
                      <tr>
                        <th>Test</th>
                        <td>{attemptTitle}</td>
                      </tr>
                      <tr>
                        <th>Attempt Date</th>
                        <td>{formatAttemptDetailDateTime(selectedAttempt.created_at)}</td>
                      </tr>
                      <tr>
                        <th>Tab left count</th>
                        <td className={tabLeftCount > 0 ? "attempt-detail-warn-value" : ""}>{tabLeftCount}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="attempt-detail-actions">
                  <button
                    className="attempt-detail-action-button"
                    type="button"
                    onClick={() => exportSelectedAttemptCsv(selectedAttempt)}
                  >
                    <span className="attempt-detail-action-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" focusable="false">
                        <path d="M10 3v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M6.5 8.5 10 12l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M4 15h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span>Export Attempt Detail (csv)</span>
                  </button>
                  <button
                    className="attempt-detail-action-button"
                    type="button"
                    disabled
                  >
                    <span className="attempt-detail-action-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" focusable="false">
                        <path d="M10 3v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M6.5 8.5 10 12l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M4 15h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span>Export Overview (PDF)</span>
                  </button>
                  <button
                    className="attempt-detail-action-button attempt-detail-action-button-danger"
                    type="button"
                    onClick={() => deleteAttempt(selectedAttempt.id)}
                  >
                    <span className="attempt-detail-action-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20" focusable="false">
                        <path d="M5 5 15 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                        <path d="M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span>Delete Attempt</span>
                  </button>
                </div>
              </div>
              <div className="attempt-detail-top-divider" />
              {attemptQuestionsLoading ? <div className="admin-help">Loading questions...</div> : null}
              {attemptQuestionsError ? <div className="admin-msg">{attemptQuestionsError}</div> : null}

              <div className="admin-top-tabs attempt-detail-tabs" style={{ marginBottom: 12 }}>
                <button
                  className={`admin-top-tab ${attemptDetailTab === "overview" ? "active" : ""}`}
                  type="button"
                  onClick={() => setAttemptDetailTab("overview")}
                >
                  Overview
                </button>
                {!showSummaryOnly ? (
                  <button
                    className={`admin-top-tab ${attemptDetailTab === "questions" ? "active" : ""}`}
                    type="button"
                    onClick={() => setAttemptDetailTab("questions")}
                  >
                    All Questions
                  </button>
                ) : null}
              </div>

              {attemptDetailTab === "overview" ? (
                <div className="attempt-detail-pane">
                  <div className="attempt-detail-score-summary">
                    <div className="attempt-detail-score-row">
                      <span className="attempt-detail-score-label">Total Score</span>
                      <span className={`attempt-detail-score-right ${selectedAttemptIsPass ? "" : "attempt-detail-score-right-fail"}`}>
                        <span className="attempt-detail-score-value">
                          <span className="attempt-detail-score-value-primary">{totalCorrect}</span>
                          <span className="attempt-detail-score-value-separator">/</span>
                          <span>{totalQuestions}</span>
                        </span>
                        <span className="attempt-detail-score-rate">({scorePercent}%)</span>
                      </span>
                    </div>
                    <div className="attempt-detail-score-row">
                      <span className="attempt-detail-score-label">Pass/Fail</span>
                      <span className={`attempt-detail-score-pass ${selectedAttemptIsPass ? "pass" : "fail"}`}>
                        {selectedAttemptIsPass ? "Pass" : "Fail"}
                      </span>
                    </div>
                    <div className="attempt-detail-score-row">
                      <span className="attempt-detail-score-label">Class Rank</span>
                      <span className="attempt-detail-score-rank">
                        {selectedAttemptRankInfo
                          ? `${formatOrdinal(selectedAttemptRankInfo.rank)} of ${selectedAttemptRankInfo.total} students`
                          : "—"}
                      </span>
                    </div>
                  </div>

                  {selectedAttemptIsModel && selectedAttemptMainSectionSummary.length ? (
                    <>
                      <div className="attempt-detail-overview-grid">
                        <div className="session-radar-wrap">
                          {buildSectionRadarSvg(radarData)}
                        </div>
                        <div className="admin-table-wrap">
                          <table className="admin-table attempt-score-detail-table" style={{ minWidth: 640 }}>
                            {showRankingMainSectionsOnly ? null : (
                              <colgroup>
                                <col className="attempt-score-detail-col-section" />
                                <col className="attempt-score-detail-col-subsection" />
                                <col className="attempt-score-detail-col-total" />
                                <col className="attempt-score-detail-col-correct" />
                                <col className="attempt-score-detail-col-rate" />
                              </colgroup>
                            )}
                            <thead>
                              <tr>
                                <th className="attempt-score-detail-head-section">Section</th>
                                {showRankingMainSectionsOnly ? null : <th className="attempt-score-detail-head-subsection">Sub-section</th>}
                                <th className="attempt-score-detail-head-total">Total</th>
                                <th className="attempt-score-detail-head-correct">Correct</th>
                                <th className="attempt-score-detail-head-rate">%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {showRankingMainSectionsOnly
                                ? selectedAttemptMainSectionSummary.map((section) => {
                                    const isSectionBelowPass = section.rate < selectedAttemptPassRate;
                                    return (
                                      <tr key={`attempt-ranking-main-${section.section}`}>
                                        <td className="attempt-score-detail-cell-section">
                                          <span className="session-ranking-section-header">{renderTwoLineHeader(section.section)}</span>
                                        </td>
                                        <td className="attempt-score-detail-cell-total">{section.total}</td>
                                        <td className={`attempt-score-detail-cell-correct ${isSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{section.correct}</td>
                                        <td className={`attempt-score-detail-cell-rate ${isSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{(section.rate * 100).toFixed(1)}%</td>
                                      </tr>
                                    );
                                  })
                                : selectedAttemptNestedSectionSummary.map((group) => {
                                    const rowSpan = 1 + group.subSections.length;
                                    const isGroupBelowPass = group.rate < selectedAttemptPassRate;
                                    return (
                                      <Fragment key={`attempt-group-${group.mainSection}`}>
                                        <tr className="attempt-overview-total-row">
                                          <td rowSpan={rowSpan} className="attempt-overview-area-cell attempt-score-detail-cell-section">
                                            <span className="session-ranking-section-header">{renderTwoLineHeader(group.mainSection)}</span>
                                          </td>
                                          <td className="attempt-score-detail-cell-subsection">
                                            <span className="attempt-score-detail-total-label">Total</span>
                                          </td>
                                          <td className="attempt-score-detail-cell-total">{group.total}</td>
                                          <td className={`attempt-score-detail-cell-correct ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{group.correct}</td>
                                          <td className={`attempt-score-detail-cell-rate ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{(group.rate * 100).toFixed(1)}%</td>
                                        </tr>
                                        {group.subSections.map((subSection) => {
                                          const isSubSectionBelowPass = subSection.rate < selectedAttemptPassRate;
                                          return (
                                            <tr key={`attempt-sub-${group.mainSection}-${subSection.section}`}>
                                              <td className="attempt-score-detail-cell-subsection">{subSection.section}</td>
                                              <td className="attempt-score-detail-cell-total">{subSection.total}</td>
                                              <td className={`attempt-score-detail-cell-correct ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{subSection.correct}</td>
                                              <td className={`attempt-score-detail-cell-rate ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{(subSection.rate * 100).toFixed(1)}%</td>
                                            </tr>
                                          );
                                        })}
                                      </Fragment>
                                    );
                                  })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      {!showRankingMainSectionsOnly && !showSummaryOnly ? (
                        <div className="admin-help">
                          Main section totals are shown with their sub-section breakdown underneath.
                        </div>
                      ) : null}
                    </>
                  ) : (
                    selectedAttemptUsesImportedSummary ? (
                      <div className="admin-help" style={{ marginTop: 10 }}>
                        Imported summary results do not include question-level detail.
                      </div>
                    ) : selectedAttemptIsModel ? (
                      <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                        <table className="admin-table" style={{ minWidth: 520 }}>
                          <thead>
                            <tr>
                              <th>Section</th>
                              <th>Correct</th>
                              <th>Total</th>
                              <th>Rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedAttemptSectionSummary.map((section) => (
                              <tr key={`attempt-overview-${section.section}`}>
                                <td>{section.section}</td>
                                <td>{section.correct}</td>
                                <td>{section.total}</td>
                                <td>{(section.rate * 100).toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null
                  )}
                </div>
              ) : !showSummaryOnly ? (
                <div className="attempt-detail-pane">
                  <div className="student-detail-tab-row" style={{ marginBottom: 2 }}>
                    <label className="attempt-detail-toggle">
                      <input
                        type="checkbox"
                        checked={attemptDetailWrongOnly}
                        onChange={(e) => setAttemptDetailWrongOnly(e.target.checked)}
                      />
                      Wrong questions only
                    </label>
                    {selectedAttemptIsModel && selectedAttemptQuestionSectionsFiltered.length ? (
                      <div className="attempt-detail-jumps">
                        {selectedAttemptQuestionSectionsFiltered.map((section) => (
                          <button
                            key={`attempt-jump-${section.title}`}
                            className="btn"
                            type="button"
                            onClick={() =>
                              attemptDetailSectionRefs.current[section.title]?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              })
                            }
                          >
                            {section.title}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {selectedAttemptQuestionSectionsFiltered.length ? (
                    selectedAttemptIsModel ? (
                      <div className="attempt-question-sections">
                        {selectedAttemptQuestionSectionsFiltered.map((section) => (
                          <div key={`attempt-question-section-${section.title}`} className="attempt-question-section">
                            <div
                              ref={(node) => {
                                if (node) attemptDetailSectionRefs.current[section.title] = node;
                              }}
                              className="admin-title"
                              style={{ fontSize: 22, marginTop: 6 }}
                            >
                              {section.title}
                            </div>
                            <div className="attempt-question-list">
                              {section.rows.map((row, rowIndex) => (
                                <div
                                  key={`attempt-question-row-${section.title}-${row.qid}-${rowIndex}`}
                                  className={`attempt-question-card ${row.isCorrect ? "correct" : "wrong"}`}
                                >
                                  <div className="attempt-question-card-head">
                                    <div className="attempt-question-card-title">
                                      {row.qid} {row.section ? `(${row.section})` : ""}
                                    </div>
                                    <span className={`attempt-question-pill ${row.isCorrect ? "correct" : "wrong"}`}>
                                      {row.isCorrect ? "Correct" : "Wrong"}
                                    </span>
                                  </div>
                                  <div
                                    className="attempt-question-card-prompt"
                                    dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(row.prompt || "") }}
                                  />
                                  {row.stemAudios?.length || row.stemImages?.length ? (
                                    <div className="attempt-question-card-media">
                                      {(row.stemAudios ?? []).map((asset, assetIndex) => (
                                        <audio
                                          key={`attempt-audio-${row.qid}-${assetIndex}`}
                                          controls
                                          preload="none"
                                          src={asset}
                                          className="attempt-question-card-audio"
                                        />
                                      ))}
                                      {(row.stemImages ?? []).map((asset, assetIndex) => (
                                        <img
                                          key={`attempt-image-${row.qid}-${assetIndex}`}
                                          src={asset}
                                          alt="stem"
                                          className="attempt-question-card-image"
                                        />
                                      ))}
                                    </div>
                                  ) : null}
                                  <div className="attempt-question-card-answer-grid">
                                    <div className="attempt-question-card-answer">
                                      <div className="attempt-question-card-answer-label">Chosen</div>
                                      <div className="attempt-question-card-answer-value">
                                        {row.chosenImage ? (
                                          <img src={row.chosenImage} alt="chosen" className="attempt-question-card-choice-image" />
                                        ) : (
                                          row.chosen || "—"
                                        )}
                                      </div>
                                    </div>
                                    <div className="attempt-question-card-answer">
                                      <div className="attempt-question-card-answer-label">Correct</div>
                                      <div className="attempt-question-card-answer-value">
                                        {row.correctImage ? (
                                          <img src={row.correctImage} alt="correct" className="attempt-question-card-choice-image" />
                                        ) : (
                                          row.correct || "—"
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="attempt-question-list">
                        {selectedAttemptQuestionSectionsFiltered.flatMap((section) =>
                          section.rows.map((row, rowIndex) => (
                            <div
                              key={`attempt-question-row-daily-${section.title}-${row.qid}-${rowIndex}`}
                              className={`attempt-question-card ${row.isCorrect ? "correct" : "wrong"}`}
                            >
                              <div className="attempt-question-card-head">
                                <div className="attempt-question-card-title">
                                  {row.qid}
                                </div>
                                <span className={`attempt-question-pill ${row.isCorrect ? "correct" : "wrong"}`}>
                                  {row.isCorrect ? "Correct" : "Wrong"}
                                </span>
                              </div>
                              <div
                                className="attempt-question-card-prompt"
                                dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(row.prompt || "") }}
                              />
                              {row.stemAudios?.length || row.stemImages?.length ? (
                                <div className="attempt-question-card-media">
                                  {(row.stemAudios ?? []).map((asset, assetIndex) => (
                                    <audio
                                      key={`attempt-audio-daily-${row.qid}-${assetIndex}`}
                                      controls
                                      preload="none"
                                      src={asset}
                                      className="attempt-question-card-audio"
                                    />
                                  ))}
                                  {(row.stemImages ?? []).map((asset, assetIndex) => (
                                    <img
                                      key={`attempt-image-daily-${row.qid}-${assetIndex}`}
                                      src={asset}
                                      alt="stem"
                                      className="attempt-question-card-image"
                                    />
                                  ))}
                                </div>
                              ) : null}
                              <div className="attempt-question-card-answer-grid">
                                <div className="attempt-question-card-answer">
                                  <div className="attempt-question-card-answer-label">Chosen</div>
                                  <div className="attempt-question-card-answer-value">
                                    {row.chosenImage ? (
                                      <img src={row.chosenImage} alt="chosen" className="attempt-question-card-choice-image" />
                                    ) : (
                                      row.chosen || "—"
                                    )}
                                  </div>
                                </div>
                                <div className="attempt-question-card-answer">
                                  <div className="attempt-question-card-answer-label">Correct</div>
                                  <div className="attempt-question-card-answer-value">
                                    {row.correctImage ? (
                                      <img src={row.correctImage} alt="correct" className="attempt-question-card-choice-image" />
                                    ) : (
                                      row.correct || "—"
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )
                  ) : (
                    <div className="admin-help" style={{ marginTop: 6 }}>
                      {attemptDetailWrongOnly ? "No wrong questions in this attempt." : "No questions available."}
                    </div>
                  )}
                </div>
              ) : null}
              </div>
            </div>
          </div>
        ), document.body);
      })() : null}
    </>
  );
}
