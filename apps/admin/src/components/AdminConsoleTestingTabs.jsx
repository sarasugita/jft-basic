"use client";

export default function AdminConsoleTestingTabs({
  activeTab,
  modelSubTab,
  dailySubTab,
  sessionDetail,
  openModelConductModal,
  fetchTestSessions,
  fetchExamLinks,
  modelSessions,
  editingSessionId,
  openSessionDetailView,
  formatDateTime,
  editingSessionForm,
  setEditingSessionForm,
  getProblemSetDisplayId,
  tests,
  getSessionEffectivePassRate,
  linkBySession,
  copyLink,
  openSessionPreview,
  saveSessionEdits,
  cancelEditSession,
  startEditSession,
  deleteTestSession,
  testSessionsMsg,
  linkMsg,
  editingSessionMsg,
  modelConductOpen,
  setModelConductOpen,
  setModelConductMode,
  setModelRetakeSourceId,
  setActiveModelTimePicker,
  modelConductMode,
  pastModelSessions,
  selectModelRetakeSource,
  testSessionForm,
  setTestSessionForm,
  TWELVE_HOUR_TIME_OPTIONS,
  FIVE_MINUTE_MINUTE_OPTIONS,
  MERIDIEM_OPTIONS,
  getTwelveHourTimeParts,
  formatTwelveHourTimeDisplay,
  activeModelTimePicker,
  updateModelSessionTimePart,
  createTestSession,
  modelRetakeSourceId,
  modelConductCategory,
  setModelConductCategory,
  modelCategories,
  modelConductTests,
  getStudentBaseUrl,
  openModelUploadModal,
  modelUploadOpen,
  setModelUploadOpen,
  modelUploadCategory,
  setModelUploadCategory,
  groupedModelUploadTests,
  editingTestId,
  openPreview,
  editingCategorySelect,
  setEditingCategorySelect,
  editingTestForm,
  setEditingTestForm,
  saveTestEdits,
  cancelEditTest,
  startEditTest,
  deleteTest,
  testsMsg,
  assetUploadMsg,
  assetImportMsg,
  assetsMsg,
  assetCategorySelect,
  setAssetCategorySelect,
  assetForm,
  setAssetForm,
  DEFAULT_MODEL_CATEGORY,
  setAssetFile,
  assetCsvFile,
  setAssetCsvFile,
  assetFolderInputRef,
  assetFiles,
  setAssetFiles,
  uploadAssets,
  dailySessions,
  testMetaByVersion,
  dailyConductOpen,
  setDailyConductOpen,
  setDailyConductMode,
  setDailyRetakeCategory,
  setDailyRetakeSourceId,
  setDailySetDropdownOpen,
  setActiveDailyTimePicker,
  dailyConductMode,
  pastDailySessionCategories,
  dailyRetakeCategory,
  filteredPastDailySessions,
  selectDailyRetakeSource,
  dailySessionForm,
  setDailySessionForm,
  activeDailyTimePicker,
  updateDailySessionTimePart,
  createDailySession,
  dailyRetakeSourceId,
  dailySourceCategoryDropdownRef,
  dailyCategories,
  dailySourceCategoryDropdownOpen,
  setDailySourceCategoryDropdownOpen,
  selectedDailySourceCategoryNames,
  toggleDailySourceCategorySelection,
  dailyConductCategory,
  setDailyConductCategory,
  dailySetDropdownRef,
  dailyConductTests,
  selectedDailyProblemSetIds,
  toggleDailyProblemSetSelection,
  dailySessionCategories,
  dailySessionCategorySelectValue,
  CUSTOM_CATEGORY_OPTION,
  selectedDailyQuestionCount,
  dailyUploadOpen,
  setDailyUploadOpen,
  dailyUploadCategory,
  setDailyUploadCategory,
  groupedDailyUploadTests,
  dailyUploadMsg,
  dailyImportMsg,
  editingTestMsg,
  dailyCategorySelect,
  setDailyCategorySelect,
  dailyForm,
  setDailyForm,
  setDailyFile,
  dailyCsvFile,
  setDailyCsvFile,
  dailyFolderInputRef,
  dailyFiles,
  setDailyFiles,
  uploadDailyAssets,
}) {
  return (
    <>
      {activeTab === "model" ? (
        <>
          {modelSubTab === "conduct" ? (
            <div style={{ marginBottom: 12 }}>
              {!(sessionDetail.type === "mock" && sessionDetail.sessionId) ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div className="admin-title">Test Sessions</div>
                      <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" onClick={() => openModelConductModal("normal")}>
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path
                            d="M10 5v10M5 10h10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                        Create Test Session
                      </button>
                      <button className="btn btn-retake admin-compact-action-btn admin-upload-cta-btn" onClick={() => openModelConductModal("retake")}>
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path
                            d="M5.5 6.5h8V4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M13.5 13.5h-8V16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M13.5 4l2.5 2.5-2.5 2.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M6.5 16 4 13.5 6.5 11"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Create Retake Session
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn admin-icon-action-btn"
                      aria-label="Refresh sessions"
                      title="Refresh sessions"
                      onClick={() => {
                        fetchTestSessions();
                        fetchExamLinks();
                      }}
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
                  </div>
                </div>
              ) : null}

              {sessionDetail.type === "mock" && sessionDetail.sessionId ? null : (
                <>
                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 860 }}>
                      <thead>
                        <tr>
                          <th>Created</th>
                          <th>Test Title</th>
                          <th>SetID</th>
                          <th>Show Answers</th>
                          <th>Attempts</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Time (min)</th>
                          <th>Pass Rate</th>
                          <th style={{ textAlign: "center" }}>Action</th>
                          <th style={{ textAlign: "center" }}>Preview</th>
                          <th style={{ textAlign: "center" }}>Edit</th>
                          <th style={{ textAlign: "center" }}>Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modelSessions.map((t) => (
                          <tr key={t.id} onClick={editingSessionId === t.id ? undefined : () => openSessionDetailView(t, "mock")}>
                            <td>{formatDateTime(t.created_at)}</td>
                            <td>
                              {editingSessionId === t.id ? (
                                <input
                                  value={editingSessionForm.title}
                                  onChange={(e) => setEditingSessionForm((s) => ({ ...s, title: e.target.value }))}
                                />
                              ) : (
                                t.title ?? ""
                              )}
                            </td>
                            <td>{getProblemSetDisplayId(t.problem_set_id, tests)}</td>
                            <td>
                              {editingSessionId === t.id ? (
                                <select
                                  value={editingSessionForm.show_answers ? "yes" : "no"}
                                  onChange={(e) => setEditingSessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
                                >
                                  <option value="yes">Yes</option>
                                  <option value="no">No</option>
                                </select>
                              ) : (
                                t.show_answers ? "Yes" : "No"
                              )}
                            </td>
                            <td>
                              {editingSessionId === t.id ? (
                                <select
                                  value={editingSessionForm.allow_multiple_attempts ? "multiple" : "once"}
                                  onChange={(e) =>
                                    setEditingSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.value === "multiple" }))
                                  }
                                >
                                  <option value="once">Only once</option>
                                  <option value="multiple">Allow multiple</option>
                                </select>
                              ) : (
                                t.allow_multiple_attempts === false ? "Only once" : "Allow multiple"
                              )}
                            </td>
                            <td>
                              {editingSessionId === t.id ? (
                                <input
                                  type="datetime-local"
                                  step="300"
                                  value={editingSessionForm.starts_at}
                                  onChange={(e) => setEditingSessionForm((s) => ({ ...s, starts_at: e.target.value }))}
                                />
                              ) : (
                                formatDateTime(t.starts_at)
                              )}
                            </td>
                            <td>
                              {editingSessionId === t.id ? (
                                <input
                                  type="datetime-local"
                                  step="300"
                                  value={editingSessionForm.ends_at}
                                  onChange={(e) => setEditingSessionForm((s) => ({ ...s, ends_at: e.target.value }))}
                                />
                              ) : (
                                formatDateTime(t.ends_at)
                              )}
                            </td>
                            <td>
                              {editingSessionId === t.id ? (
                                <input
                                  value={editingSessionForm.time_limit_min}
                                  onChange={(e) => setEditingSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                                />
                              ) : (
                                t.time_limit_min ?? ""
                              )}
                            </td>
                            <td>
                              {editingSessionId === t.id ? (
                                <input
                                  value={editingSessionForm.pass_rate}
                                  onChange={(e) => setEditingSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                                />
                              ) : (
                                `${(getSessionEffectivePassRate(t) * 100).toFixed(0)}%`
                              )}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              {linkBySession[t.id]?.id ? (
                                <button
                                  className="btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyLink(linkBySession[t.id].id);
                                  }}
                                >
                                  Copy URL
                                </button>
                              ) : (
                                ""
                              )}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <button
                                className="btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSessionPreview(t);
                                }}
                              >
                                Preview
                              </button>
                            </td>
                            <td style={{ textAlign: "center" }}>
                              {editingSessionId === t.id ? (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); saveSessionEdits(); }}>
                                    Save
                                  </button>
                                  <button className="btn" onClick={(e) => { e.stopPropagation(); cancelEditSession(); }}>
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button className="btn" onClick={(e) => { e.stopPropagation(); startEditSession(t); }}>
                                  Edit
                                </button>
                              )}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <button className="btn btn-danger" onClick={(e) => { e.stopPropagation(); deleteTestSession(t.id); }}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-msg">{testSessionsMsg}</div>
                  <div className="admin-msg">{linkMsg}</div>
                  {editingSessionMsg ? <div className="admin-msg">{editingSessionMsg}</div> : null}
                </>
              )}

              {modelConductOpen ? (
                <div
                  className="admin-modal-overlay"
                  onClick={() => {
                    setModelConductOpen(false);
                    setModelConductMode("normal");
                    setModelRetakeSourceId("");
                    setActiveModelTimePicker("");
                  }}
                >
                  <div
                    className="admin-modal daily-session-create-modal"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="admin-modal-header daily-session-create-header">
                      <div className="admin-title">{modelConductMode === "retake" ? "Conduct Model Retake" : "Create Model Test Session"}</div>
                      <button
                        className="admin-modal-close"
                        onClick={() => {
                          setModelConductOpen(false);
                          setModelConductMode("normal");
                          setModelRetakeSourceId("");
                          setActiveModelTimePicker("");
                        }}
                        aria-label="Close"
                      >
                        &times;
                      </button>
                    </div>

                    <div className="daily-session-create-body">
                      {modelConductMode === "retake" ? (
                        <div className="daily-session-create-layout">
                          <div className="daily-session-create-field">
                            <label>Original Session</label>
                            <select
                              value={modelRetakeSourceId}
                              onChange={(e) => selectModelRetakeSource(e.target.value)}
                            >
                              {pastModelSessions.length ? (
                                pastModelSessions.map((session) => (
                                  <option key={`model-retake-${session.id}`} value={session.id}>
                                    {session.title || session.problem_set_id} ({formatDateTime(session.ends_at || session.starts_at || session.created_at)})
                                  </option>
                                ))
                              ) : (
                                <option value="">No past model sessions</option>
                              )}
                            </select>
                          </div>
                          <div className="daily-session-create-field">
                            <label>Release To</label>
                            <select
                              value={testSessionForm.retake_release_scope}
                              onChange={(e) => setTestSessionForm((s) => ({ ...s, retake_release_scope: e.target.value }))}
                            >
                              <option value="all">All students</option>
                              <option value="failed_only">Only students who failed</option>
                            </select>
                          </div>
                          <div className="daily-session-create-field">
                            <label>Test Title</label>
                            <input
                              value={testSessionForm.title}
                              onChange={(e) => setTestSessionForm((s) => ({ ...s, title: e.target.value }))}
                              placeholder="Mock Test (Retake)"
                            />
                          </div>
                          <div className="daily-session-create-split-row">
                            <div className="daily-session-create-field">
                              <label>Date</label>
                              <input
                                type="date"
                                value={testSessionForm.session_date}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, session_date: e.target.value }))}
                              />
                            </div>
                            <div className="daily-session-create-field">
                              <label>Start Time</label>
                              <div className="daily-session-create-time-picker-wrap" data-model-time-picker>
                                {(() => {
                                  const startTimeParts = getTwelveHourTimeParts(testSessionForm.start_time);
                                  const isOpen = activeModelTimePicker === "start_time";
                                  return (
                                    <>
                                      <button
                                        type="button"
                                        className="daily-session-create-time-trigger"
                                        aria-haspopup="dialog"
                                        aria-expanded={isOpen}
                                        onClick={() => setActiveModelTimePicker((current) => (current === "start_time" ? "" : "start_time"))}
                                      >
                                        <span>{formatTwelveHourTimeDisplay(testSessionForm.start_time)}</span>
                                        <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                      </button>
                                      {isOpen ? (
                                        <div className="daily-session-create-time-popover" role="dialog" aria-label="Select model retake start time">
                                          <div className="daily-session-create-time-columns">
                                            <div className="daily-session-create-time-column">
                                              {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                                <button
                                                  key={`model-retake-start-hour-${hourValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${startTimeParts.hour === hourValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("start_time", "hour", hourValue)}
                                                >
                                                  {hourValue}
                                                </button>
                                              ))}
                                            </div>
                                            <div className="daily-session-create-time-column">
                                              {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                                <button
                                                  key={`model-retake-start-minute-${minuteValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${startTimeParts.minute === minuteValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("start_time", "minute", minuteValue)}
                                                >
                                                  {minuteValue}
                                                </button>
                                              ))}
                                            </div>
                                            <div className="daily-session-create-time-column">
                                              {MERIDIEM_OPTIONS.map((periodValue) => (
                                                <button
                                                  key={`model-retake-start-period-${periodValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${startTimeParts.period === periodValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("start_time", "period", periodValue)}
                                                >
                                                  {periodValue}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      ) : null}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="daily-session-create-field">
                              <label>Close Time</label>
                              <div className="daily-session-create-time-picker-wrap" data-model-time-picker>
                                {(() => {
                                  const closeTimeParts = getTwelveHourTimeParts(testSessionForm.close_time);
                                  const isOpen = activeModelTimePicker === "close_time";
                                  return (
                                    <>
                                      <button
                                        type="button"
                                        className="daily-session-create-time-trigger"
                                        aria-haspopup="dialog"
                                        aria-expanded={isOpen}
                                        onClick={() => setActiveModelTimePicker((current) => (current === "close_time" ? "" : "close_time"))}
                                      >
                                        <span>{formatTwelveHourTimeDisplay(testSessionForm.close_time)}</span>
                                        <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                      </button>
                                      {isOpen ? (
                                        <div className="daily-session-create-time-popover" role="dialog" aria-label="Select model retake close time">
                                          <div className="daily-session-create-time-columns">
                                            <div className="daily-session-create-time-column">
                                              {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                                <button
                                                  key={`model-retake-close-hour-${hourValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${closeTimeParts.hour === hourValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("close_time", "hour", hourValue)}
                                                >
                                                  {hourValue}
                                                </button>
                                              ))}
                                            </div>
                                            <div className="daily-session-create-time-column">
                                              {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                                <button
                                                  key={`model-retake-close-minute-${minuteValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${closeTimeParts.minute === minuteValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("close_time", "minute", minuteValue)}
                                                >
                                                  {minuteValue}
                                                </button>
                                              ))}
                                            </div>
                                            <div className="daily-session-create-time-column">
                                              {MERIDIEM_OPTIONS.map((periodValue) => (
                                                <button
                                                  key={`model-retake-close-period-${periodValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${closeTimeParts.period === periodValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("close_time", "period", periodValue)}
                                                >
                                                  {periodValue}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      ) : null}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                          <div className="daily-session-create-two-col">
                            <div className="daily-session-create-field">
                              <label>Time Limit (min)</label>
                              <input
                                value={testSessionForm.time_limit_min}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                                placeholder="60"
                              />
                            </div>
                            <div className="daily-session-create-field">
                              <label>Pass Rate</label>
                              <input
                                value={testSessionForm.pass_rate}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                                placeholder="0.8"
                              />
                            </div>
                          </div>
                          <div className="daily-session-create-toggle-row">
                            <span>Show Answers</span>
                            <label className="daily-session-create-switch" aria-label="Show Answers">
                              <input
                                type="checkbox"
                                checked={testSessionForm.show_answers}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, show_answers: e.target.checked }))}
                              />
                              <span className="daily-session-create-switch-slider" />
                            </label>
                          </div>
                          <div className="daily-session-create-toggle-row">
                            <span>Allow Multiple Attempts</span>
                            <label className="daily-session-create-switch" aria-label="Allow Multiple Attempts">
                              <input
                                type="checkbox"
                                checked={testSessionForm.allow_multiple_attempts}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.checked }))}
                              />
                              <span className="daily-session-create-switch-slider" />
                            </label>
                          </div>
                          <div className="daily-session-create-actions">
                            <button
                              className="btn btn-retake"
                              type="button"
                              onClick={createTestSession}
                              disabled={!modelRetakeSourceId}
                            >
                              Create Session
                            </button>
                          </div>
                          {testSessionsMsg ? <div className="admin-msg">{testSessionsMsg}</div> : null}
                        </div>
                      ) : (
                        <div className="daily-session-create-layout">
                          <div className="daily-session-create-field">
                            <label>Category</label>
                            <select
                              value={modelConductCategory}
                              onChange={(e) => setModelConductCategory(e.target.value)}
                            >
                              {modelCategories.length ? (
                                <>
                                  <option value="">Select category</option>
                                  {modelCategories.map((c) => (
                                    <option key={`model-cat-${c.name}`} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                                </>
                              ) : (
                                <option value="">No categories</option>
                              )}
                            </select>
                          </div>
                          <div className="daily-session-create-field">
                            <label>Set ID</label>
                            <select
                              value={testSessionForm.problem_set_id}
                              onChange={(e) => setTestSessionForm((s) => ({ ...s, problem_set_id: e.target.value }))}
                            >
                              {modelConductTests.length ? (
                                modelConductTests.map((t) => (
                                  <option key={`ps-${t.version}`} value={t.version}>
                                    {t.version}
                                  </option>
                                ))
                              ) : (
                                <option value="">No problem sets</option>
                              )}
                            </select>
                          </div>
                          <div className="daily-session-create-field">
                            <label>Test Title</label>
                            <input
                              value={testSessionForm.title}
                              onChange={(e) => setTestSessionForm((s) => ({ ...s, title: e.target.value }))}
                              placeholder="Mock Test"
                            />
                          </div>
                          <div className="daily-session-create-split-row">
                            <div className="daily-session-create-field">
                              <label>Date</label>
                              <input
                                type="date"
                                value={testSessionForm.session_date}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, session_date: e.target.value }))}
                              />
                            </div>
                            <div className="daily-session-create-field">
                              <label>Start Time</label>
                              <div className="daily-session-create-time-picker-wrap" data-model-time-picker>
                                {(() => {
                                  const startTimeParts = getTwelveHourTimeParts(testSessionForm.start_time);
                                  const isOpen = activeModelTimePicker === "start_time";
                                  return (
                                    <>
                                      <button
                                        type="button"
                                        className="daily-session-create-time-trigger"
                                        aria-haspopup="dialog"
                                        aria-expanded={isOpen}
                                        onClick={() => setActiveModelTimePicker((current) => (current === "start_time" ? "" : "start_time"))}
                                      >
                                        <span>{formatTwelveHourTimeDisplay(testSessionForm.start_time)}</span>
                                        <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                      </button>
                                      {isOpen ? (
                                        <div className="daily-session-create-time-popover" role="dialog" aria-label="Select model start time">
                                          <div className="daily-session-create-time-columns">
                                            <div className="daily-session-create-time-column">
                                              {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                                <button
                                                  key={`model-start-hour-${hourValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${startTimeParts.hour === hourValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("start_time", "hour", hourValue)}
                                                >
                                                  {hourValue}
                                                </button>
                                              ))}
                                            </div>
                                            <div className="daily-session-create-time-column">
                                              {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                                <button
                                                  key={`model-start-minute-${minuteValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${startTimeParts.minute === minuteValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("start_time", "minute", minuteValue)}
                                                >
                                                  {minuteValue}
                                                </button>
                                              ))}
                                            </div>
                                            <div className="daily-session-create-time-column">
                                              {MERIDIEM_OPTIONS.map((periodValue) => (
                                                <button
                                                  key={`model-start-period-${periodValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${startTimeParts.period === periodValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("start_time", "period", periodValue)}
                                                >
                                                  {periodValue}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      ) : null}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="daily-session-create-field">
                              <label>Close Time</label>
                              <div className="daily-session-create-time-picker-wrap" data-model-time-picker>
                                {(() => {
                                  const closeTimeParts = getTwelveHourTimeParts(testSessionForm.close_time);
                                  const isOpen = activeModelTimePicker === "close_time";
                                  return (
                                    <>
                                      <button
                                        type="button"
                                        className="daily-session-create-time-trigger"
                                        aria-haspopup="dialog"
                                        aria-expanded={isOpen}
                                        onClick={() => setActiveModelTimePicker((current) => (current === "close_time" ? "" : "close_time"))}
                                      >
                                        <span>{formatTwelveHourTimeDisplay(testSessionForm.close_time)}</span>
                                        <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                      </button>
                                      {isOpen ? (
                                        <div className="daily-session-create-time-popover" role="dialog" aria-label="Select model close time">
                                          <div className="daily-session-create-time-columns">
                                            <div className="daily-session-create-time-column">
                                              {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                                <button
                                                  key={`model-close-hour-${hourValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${closeTimeParts.hour === hourValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("close_time", "hour", hourValue)}
                                                >
                                                  {hourValue}
                                                </button>
                                              ))}
                                            </div>
                                            <div className="daily-session-create-time-column">
                                              {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                                <button
                                                  key={`model-close-minute-${minuteValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${closeTimeParts.minute === minuteValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("close_time", "minute", minuteValue)}
                                                >
                                                  {minuteValue}
                                                </button>
                                              ))}
                                            </div>
                                            <div className="daily-session-create-time-column">
                                              {MERIDIEM_OPTIONS.map((periodValue) => (
                                                <button
                                                  key={`model-close-period-${periodValue}`}
                                                  type="button"
                                                  className={`daily-session-create-time-option ${closeTimeParts.period === periodValue ? "active" : ""}`}
                                                  onClick={() => updateModelSessionTimePart("close_time", "period", periodValue)}
                                                >
                                                  {periodValue}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      ) : null}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                          <div className="daily-session-create-two-col">
                            <div className="daily-session-create-field">
                              <label>Time Limit (min)</label>
                              <input
                                value={testSessionForm.time_limit_min}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                                placeholder="60"
                              />
                            </div>
                            <div className="daily-session-create-field">
                              <label>Pass Rate</label>
                              <input
                                value={testSessionForm.pass_rate}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                                placeholder="0.8"
                              />
                            </div>
                          </div>
                          <div className="daily-session-create-toggle-row">
                            <span>Show Answers</span>
                            <label className="daily-session-create-switch" aria-label="Show Answers">
                              <input
                                type="checkbox"
                                checked={testSessionForm.show_answers}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, show_answers: e.target.checked }))}
                              />
                              <span className="daily-session-create-switch-slider" />
                            </label>
                          </div>
                          <div className="daily-session-create-toggle-row">
                            <span>Allow Multiple Attempts</span>
                            <label className="daily-session-create-switch" aria-label="Allow Multiple Attempts">
                              <input
                                type="checkbox"
                                checked={testSessionForm.allow_multiple_attempts}
                                onChange={(e) => setTestSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.checked }))}
                              />
                              <span className="daily-session-create-switch-slider" />
                            </label>
                          </div>
                          <div className="daily-session-create-actions">
                            <button
                              className="btn btn-primary"
                              type="button"
                              onClick={createTestSession}
                            >
                              Create Session
                            </button>
                          </div>
                          {testSessionsMsg ? <div className="admin-msg">{testSessionsMsg}</div> : null}
                        </div>
                      )}

                    </div>

                    {modelConductMode === "retake" ? (
                      <div className="admin-help" style={{ marginTop: 6 }}>
                        Student Base URL: <b>{getStudentBaseUrl() || "Not set"}</b>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {modelSubTab === "upload" ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div className="admin-title">Set Upload (CSV)</div>
                      <button
                        className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn"
                        onClick={openModelUploadModal}
                      >
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
                        Upload Question Set
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <select
                      value={modelUploadCategory}
                      onChange={(e) => setModelUploadCategory(e.target.value)}
                    >
                      <option value="">All Categories</option>
                      {modelCategories.map((c) => (
                        <option key={`model-upload-cat-${c.name}`} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                  {groupedModelUploadTests.map((group) => (
                    <div key={`model-upload-group-${group.name}`}>
                      {!modelUploadCategory ? (
                        <div className="admin-subtitle" style={{ fontWeight: 900 }}>{group.name}</div>
                      ) : null}
                      <div className="admin-table-wrap" style={{ marginTop: !modelUploadCategory ? 8 : 0 }}>
                        <table className="admin-table" style={{ minWidth: 860 }}>
                          <thead>
                            <tr>
                              <th>Created</th>
                              <th>SetID</th>
                              <th>Category</th>
                              <th>Questions</th>
                              <th>Preview</th>
                              <th>Edit</th>
                              <th>Delete</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.tests.map((t) => (
                              <tr
                                key={t.id}
                                onClick={editingTestId === t.id ? undefined : () => openPreview(t.version)}
                              >
                                <td>{formatDateTime(t.created_at)}</td>
                                <td>
                                  {editingTestId === t.id ? (
                                    <input
                                      value={editingTestForm.version}
                                      onChange={(e) => setEditingTestForm((s) => ({ ...s, version: e.target.value }))}
                                    />
                                  ) : (
                                    t.version ?? ""
                                  )}
                                </td>
                                <td>
                                  {editingTestId === t.id ? (
                                    <>
                                      <select
                                        value={editingCategorySelect}
                                        onChange={(e) => {
                                          const next = e.target.value;
                                          setEditingCategorySelect(next);
                                          if (next !== "__custom__") {
                                            setEditingTestForm((s) => ({ ...s, title: next }));
                                          }
                                        }}
                                      >
                                        {modelCategories.map((c) => (
                                          <option key={`edit-cat-${c.name}`} value={c.name}>{c.name}</option>
                                        ))}
                                        <option value="__custom__">Custom...</option>
                                      </select>
                                      {editingCategorySelect === "__custom__" ? (
                                        <input
                                          value={editingTestForm.title}
                                          onChange={(e) => setEditingTestForm((s) => ({ ...s, title: e.target.value }))}
                                          placeholder="Grammar Review"
                                          style={{ marginTop: 6 }}
                                        />
                                      ) : null}
                                    </>
                                  ) : (
                                    t.title ?? ""
                                  )}
                                </td>
                                <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                                <td>
                                  <button
                                    className="btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPreview(t.version);
                                    }}
                                  >
                                    Preview
                                  </button>
                                </td>
                                <td>
                                  {editingTestId === t.id ? (
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      <button
                                        className="btn btn-primary"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          saveTestEdits(modelCategories);
                                        }}
                                      >
                                        Save
                                      </button>
                                      <button
                                        className="btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          cancelEditTest();
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      className="btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startEditTest(t, modelCategories);
                                      }}
                                    >
                                      Edit
                                    </button>
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="btn btn-danger"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteTest(t.version);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
                {groupedModelUploadTests.length === 0 ? <div className="admin-msg">{testsMsg || "No sets found."}</div> : null}
                {!modelUploadOpen && assetUploadMsg ? <div className="admin-msg">{assetUploadMsg}</div> : null}
                {!modelUploadOpen && assetImportMsg ? (
                  <pre className="admin-msg" style={{ whiteSpace: "pre-wrap" }}>
                    {assetImportMsg}
                  </pre>
                ) : null}
                <div className="admin-msg">{assetsMsg}</div>
                {editingSessionMsg ? <div className="admin-msg">{editingSessionMsg}</div> : null}
                {groupedModelUploadTests.length ? <div className="admin-msg">{testsMsg}</div> : null}

                {modelUploadOpen ? (
                  <div className="admin-modal-overlay" onClick={() => setModelUploadOpen(false)}>
                    <div className="admin-modal upload-question-modal" onClick={(e) => e.stopPropagation()}>
                      <div className="admin-modal-header">
                        <div className="admin-title">Upload Model Questions</div>
                        <button className="admin-modal-close" onClick={() => setModelUploadOpen(false)} aria-label="Close">
                          &times;
                        </button>
                      </div>
                      {assetUploadMsg ? <div className="admin-msg" style={{ marginTop: 10 }}>{assetUploadMsg}</div> : null}
                      {assetImportMsg ? (
                        <pre className="admin-msg" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                          {assetImportMsg}
                        </pre>
                      ) : null}

                      <div className="admin-form upload-question-form" style={{ marginTop: 10 }}>
                        <div className="field">
                          <label>Category</label>
                          <select
                            value={assetCategorySelect}
                            onChange={(e) => {
                              const next = e.target.value;
                              setAssetCategorySelect(next);
                              if (next !== "__custom__") {
                                setAssetForm((current) => ({ ...current, category: next }));
                              }
                            }}
                          >
                            {(modelCategories.length ? modelCategories : [{ name: DEFAULT_MODEL_CATEGORY }]).map((category) => (
                              <option key={`asset-upload-category-${category.name}`} value={category.name}>
                                {category.name}
                              </option>
                            ))}
                            <option value="__custom__">Custom...</option>
                          </select>
                          {assetCategorySelect === "__custom__" ? (
                            <input
                              value={assetForm.category}
                              onChange={(e) => setAssetForm((current) => ({ ...current, category: e.target.value }))}
                              placeholder="Book Review"
                              style={{ marginTop: 6 }}
                            />
                          ) : null}
                        </div>
                        <div className="field">
                          <label>CSV File (required)</label>
                          <input
                            type="file"
                            accept=".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              setAssetFile(file);
                              if (file && file.name.toLowerCase().endsWith(".csv")) {
                                setAssetCsvFile(file);
                              }
                            }}
                          />
                          {assetCsvFile ? (
                            <div className="admin-help" style={{ marginTop: 4 }}>
                              CSV ready: {assetCsvFile.name}
                            </div>
                          ) : null}
                        </div>
                        <div className="field">
                          <label>Folder (PNG/MP3/M4A)</label>
                          <div className="upload-question-picker">
                            <input
                              ref={assetFolderInputRef}
                              className="upload-question-picker-input"
                              type="file"
                              multiple
                              webkitdirectory="true"
                              directory="true"
                              accept=".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
                              onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                setAssetFiles(files);
                                const csvFile = files.find((f) => f.name.toLowerCase().endsWith(".csv"));
                                if (csvFile) {
                                  setAssetCsvFile(csvFile);
                                }
                              }}
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
                        <div className="upload-question-actions">
                          <button className="btn btn-primary admin-upload-cta-btn" type="button" onClick={uploadAssets}>
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
                            Upload & Register Set
                          </button>
                        </div>
                      </div>
                      <div className="admin-help" style={{ marginTop: 8 }}>
                        SetID is read from the CSV `set_id` column. If the file contains multiple `set_id` values, each one is imported as a separate model test set.
                      </div>
                      <div className="admin-help" style={{ marginTop: 8 }}>
                        Template: <a href="/question_csv_template.csv" download>Model CSV template</a>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {activeTab === "daily" ? (
        <>
          {dailySubTab === "conduct" ? (
            <div className="admin-help">Loading daily testing workspace…</div>
          ) : null}

          {dailySubTab === "upload" ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div className="admin-title">Daily Test Upload (CSV)</div>
                      <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" onClick={() => setDailyUploadOpen(true)}>
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
                        Upload Question Set
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <select
                      value={dailyUploadCategory}
                      onChange={(e) => setDailyUploadCategory(e.target.value)}
                    >
                      <option value="">All Categories</option>
                      {dailyCategories.map((c) => (
                        <option key={`daily-upload-cat-${c.name}`} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                  {groupedDailyUploadTests.map((group) => (
                    <div key={`daily-upload-group-${group.name}`}>
                      {!dailyUploadCategory ? (
                        <div className="admin-subtitle" style={{ fontWeight: 900 }}>{group.name}</div>
                      ) : null}
                      <div className="admin-table-wrap" style={{ marginTop: !dailyUploadCategory ? 8 : 0 }}>
                        <table className="admin-table" style={{ minWidth: 860 }}>
                          <thead>
                            <tr>
                              <th>Created</th>
                              <th>Category</th>
                              <th>SetID</th>
                              <th>Questions</th>
                              <th>Preview</th>
                              <th>Edit</th>
                              <th>Delete</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.tests.map((t) => (
                              <tr
                                key={t.id}
                                onClick={editingTestId === t.id ? undefined : () => openPreview(t.version)}
                              >
                                <td>{formatDateTime(t.created_at)}</td>
                                <td>
                                  {editingTestId === t.id ? (
                                    <>
                                      <select
                                        value={editingCategorySelect}
                                        onChange={(e) => {
                                          const next = e.target.value;
                                          setEditingCategorySelect(next);
                                          if (next !== "__custom__") {
                                            setEditingTestForm((s) => ({ ...s, title: next }));
                                          }
                                        }}
                                      >
                                        {dailyCategories.map((c) => (
                                          <option key={`edit-cat-${c.name}`} value={c.name}>{c.name}</option>
                                        ))}
                                        <option value="__custom__">Custom...</option>
                                      </select>
                                      {editingCategorySelect === "__custom__" ? (
                                        <input
                                          value={editingTestForm.title}
                                          onChange={(e) => setEditingTestForm((s) => ({ ...s, title: e.target.value }))}
                                          placeholder="Vocabulary Test"
                                          style={{ marginTop: 6 }}
                                        />
                                      ) : null}
                                    </>
                                  ) : (
                                    t.title ?? ""
                                  )}
                                </td>
                                <td>
                                  {editingTestId === t.id ? (
                                    <input
                                      value={editingTestForm.version}
                                      onChange={(e) => setEditingTestForm((s) => ({ ...s, version: e.target.value }))}
                                    />
                                  ) : (
                                    t.version ?? ""
                                  )}
                                </td>
                                <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                                <td>
                                  <button
                                    className="btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPreview(t.version);
                                    }}
                                  >
                                    Preview
                                  </button>
                                </td>
                                <td>
                                  {editingTestId === t.id ? (
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      <button
                                        className="btn btn-primary"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          saveTestEdits(dailyCategories);
                                        }}
                                      >
                                        Save
                                      </button>
                                      <button
                                        className="btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          cancelEditTest();
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      className="btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startEditTest(t, dailyCategories);
                                      }}
                                    >
                                      Edit
                                    </button>
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="btn btn-danger"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteTest(t.version);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
                {groupedDailyUploadTests.length === 0 ? <div className="admin-msg">{testsMsg || "No daily tests found."}</div> : null}
                {!dailyUploadOpen && dailyUploadMsg ? <div className="admin-msg">{dailyUploadMsg}</div> : null}
                {!dailyUploadOpen && dailyImportMsg ? (
                  <pre className="admin-msg" style={{ whiteSpace: "pre-wrap" }}>
                    {dailyImportMsg}
                  </pre>
                ) : null}
                {editingSessionMsg ? <div className="admin-msg">{editingSessionMsg}</div> : null}
                {groupedDailyUploadTests.length ? <div className="admin-msg">{testsMsg}</div> : null}

                {dailyUploadOpen ? (
                  <div className="admin-modal-overlay" onClick={() => setDailyUploadOpen(false)}>
                    <div className="admin-modal upload-question-modal" onClick={(e) => e.stopPropagation()}>
                      <div className="admin-modal-header">
                        <div className="admin-title">Upload Daily Questions</div>
                        <button className="admin-modal-close" onClick={() => setDailyUploadOpen(false)} aria-label="Close">
                          &times;
                        </button>
                      </div>
                      {dailyUploadMsg ? <div className="admin-msg" style={{ marginTop: 10 }}>{dailyUploadMsg}</div> : null}
                      {dailyImportMsg ? (
                        <pre className="admin-msg" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                          {dailyImportMsg}
                        </pre>
                      ) : null}

                      <div className="admin-form upload-question-form" style={{ marginTop: 10 }}>
                        <div className="field">
                          <label>Category</label>
                          {dailyCategories.length ? (
                            <>
                              <select
                                value={dailyCategorySelect}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  setDailyCategorySelect(next);
                                  if (next !== "__custom__") {
                                    setDailyForm((s) => ({ ...s, category: next }));
                                  }
                                }}
                              >
                                {dailyCategories.map((c) => (
                                  <option key={`daily-cat-${c.name}`} value={c.name}>{c.name}</option>
                                ))}
                                <option value="__custom__">Custom...</option>
                              </select>
                              {dailyCategorySelect === "__custom__" ? (
                                <input
                                  value={dailyForm.category}
                                  onChange={(e) => setDailyForm((s) => ({ ...s, category: e.target.value }))}
                                  placeholder="Vocabulary Test"
                                  style={{ marginTop: 6 }}
                                />
                              ) : null}
                            </>
                          ) : (
                            <input
                              value={dailyForm.category}
                              onChange={(e) => setDailyForm((s) => ({ ...s, category: e.target.value }))}
                              placeholder="Vocabulary Test"
                            />
                          )}
                        </div>
                        <div className="field">
                          <label>CSV File (required)</label>
                          <input
                            type="file"
                            accept=".csv,.tsv"
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              setDailyFile(file);
                              if (file && (file.name.toLowerCase().endsWith(".csv") || file.name.toLowerCase().endsWith(".tsv"))) {
                                setDailyCsvFile(file);
                              }
                            }}
                          />
                          {dailyCsvFile ? (
                            <div className="admin-help" style={{ marginTop: 4 }}>
                              CSV ready: {dailyCsvFile.name}
                            </div>
                          ) : null}
                        </div>
                        <div className="field">
                          <label>Folder (PNG/MP3/M4A)</label>
                          <div className="upload-question-picker">
                            <input
                              ref={dailyFolderInputRef}
                              className="upload-question-picker-input"
                              type="file"
                              multiple
                              webkitdirectory="true"
                              directory="true"
                              accept=".csv,.tsv,.png,.jpg,.jpeg,.webp"
                              onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                setDailyFiles(files);
                                const csvFile = files.find((f) => f.name.toLowerCase().endsWith(".csv") || f.name.toLowerCase().endsWith(".tsv"));
                                if (csvFile) {
                                  setDailyCsvFile(csvFile);
                                }
                              }}
                            />
                            <button className="btn upload-question-picker-button" type="button" onClick={() => dailyFolderInputRef.current?.click()}>
                              Choose Folder
                            </button>
                          </div>
                          {dailyFiles.length ? (
                            <div className="admin-help" style={{ marginTop: 4 }}>
                              Selected: {dailyFiles.length} files
                            </div>
                          ) : null}
                        </div>
                        <div className="upload-question-actions">
                          <button className="btn btn-primary admin-upload-cta-btn" type="button" onClick={uploadDailyAssets}>
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
                            Upload & Register Daily Test
                          </button>
                        </div>
                      </div>
                      <div className="admin-help" style={{ marginTop: 8 }}>
                        SetID is read from the CSV `set_id` column. If the file contains multiple `set_id` values, each one is imported as a separate daily test set.
                      </div>
                      <div className="admin-help" style={{ marginTop: 8 }}>
                        Template: <a href="/daily_question_csv_template.csv" download>Daily CSV template</a>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
