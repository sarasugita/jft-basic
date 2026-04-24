const TEST_SESSION_IMPORT_BATCH_SIZE = 250;

function chunkItems(items, size) {
  const list = Array.isArray(items) ? items : [];
  const batchSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let index = 0; index < list.length; index += batchSize) {
    chunks.push(list.slice(index, index + batchSize));
  }
  return chunks;
}

function formatUnmatchedImportRow(rowInfo) {
  const parts = [`#${rowInfo?.rowNumber ?? "?"}`];
  if (rowInfo?.rowNumberValue) parts.push(`No.${rowInfo.rowNumberValue}`);
  if (rowInfo?.name) parts.push(`name="${rowInfo.name}"`);
  if (rowInfo?.section) parts.push(`section="${rowInfo.section}"`);
  if (rowInfo?.email) parts.push(`email="${rowInfo.email}"`);
  return parts.join(" ");
}

function logUnmatchedImportRows(label, rows, sampleSize = 10) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "";
  const sample = list.slice(0, sampleSize).map(formatUnmatchedImportRow).join("; ");
  console.warn(`[${label}] Unmatched import rows`, {
    count: list.length,
    sampleRows: list.slice(0, sampleSize),
  });
  return sample;
}

function logImportStudentRoster(label, students, sampleSize = 10) {
  const roster = Array.isArray(students) ? students : [];
  const sample = roster.slice(0, sampleSize).map((student, index) => ({
    index: index + 1,
    id: student?.id ?? "",
    name: String(student?.display_name ?? "").trim(),
    email: String(student?.email ?? "").trim(),
    section: String(
      student?.section
      ?? student?.class_section
      ?? student?.group
      ?? student?.batch
      ?? ""
    ).trim(),
    student_code: String(student?.student_code ?? "").trim(),
  }));
  console.warn(`[${label}] Import student roster`, {
    count: roster.length,
    sampleRows: sample,
  });
  return sample;
}

export async function runSearchAction(context, testType = "") {
  const {
    setLoading,
    setMsg,
    filters,
    activeTab,
    dailySubTab,
    modelSubTab,
    tests,
    setFilters,
    setAttempts,
    setSelectedId,
    supabase,
    isMissingTabLeftCountError,
  } = context;

  setLoading(true);
  setMsg("Loading...");
  const { code, name, from, to, limit, testVersion } = filters;
  const isResultsMatrixSearch =
    (testType === "daily" && activeTab === "daily" && dailySubTab === "results")
    || (testType === "mock" && activeTab === "model" && modelSubTab === "results");
  const effectiveLimit = isResultsMatrixSearch ? Math.max(Number(limit || 200), 5000) : Number(limit || 200);

  let allowedVersions = [];
  if (testType) {
    allowedVersions = tests.filter((t) => t.type === testType).map((t) => t.version);
    if (testVersion && allowedVersions.length && !allowedVersions.includes(testVersion)) {
      setFilters((s) => ({ ...s, testVersion: "" }));
    }
    if (!allowedVersions.length) {
      setAttempts([]);
      setSelectedId(null);
      setMsg("No tests.");
      setLoading(false);
      return;
    }
  }

  const buildAttemptsQuery = (fields) => {
    let query = supabase
      .from("attempts")
      .select(fields)
      .order("created_at", { ascending: false })
      .limit(effectiveLimit);
    if (testType) query = query.in("test_version", allowedVersions);
    if (code) query = query.ilike("student_code", `%${code}%`);
    if (name) query = query.ilike("display_name", `%${name}%`);
    if (from) query = query.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) query = query.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
    if (testVersion && (!testType || allowedVersions.includes(testVersion))) {
      query = query.eq("test_version", testVersion);
    }
    return query;
  };

  let { data, error } = await buildAttemptsQuery(
    "id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, ended_at, created_at, answers_json, tab_left_count"
  );
  if (error && isMissingTabLeftCountError(error)) {
    ({ data, error } = await buildAttemptsQuery(
      "id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, ended_at, created_at, answers_json"
    ));
  }
  if (error) {
    console.error("attempts fetch error:", error);
    setAttempts([]);
    setMsg(`Load failed: ${error.message}`);
    setLoading(false);
    return;
  }
  setAttempts(data ?? []);
  setSelectedId(null);
  setMsg(data?.length ? "" : "No results.");
  setLoading(false);
}

export async function clearDailyResultsForCategoryAction(context, category) {
  const {
    setQuizMsg,
    dailySessions,
    supabase,
    sessionDetail,
    closeSessionDetail,
    fetchTestSessions,
    fetchTests,
    fetchStudentAttempts,
    fetchAttempts,
    selectedStudentId,
    runSearch,
    recordAuditEvent,
  } = context;

  const categoryName = String(category?.name ?? "").trim();
  if (!categoryName) {
    setQuizMsg("Select a daily results category first.");
    return;
  }
  const testVersions = (category?.tests ?? []).map((test) => test?.version).filter(Boolean);
  const categorySessions = Array.isArray(category?.sessions) ? category.sessions : [];
  const sessionsSource = categorySessions.length
    ? categorySessions
    : (dailySessions ?? []).filter((session) => testVersions.includes(session.problem_set_id));
  const sessionsToDelete = sessionsSource
    .filter((session) => testVersions.includes(session.problem_set_id))
    .filter((session) => session?.id)
    .filter((session, index, list) => list.findIndex((item) => item.id === session.id) === index);
  const sessionIds = sessionsToDelete.map((session) => session.id);
  if (!sessionIds.length) {
    setQuizMsg(`No daily result sessions found in ${categoryName}.`);
    return;
  }

  const { count: attemptCount, error: countError } = await supabase
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .in("test_session_id", sessionIds);
  if (countError) {
    console.error("clear daily results count error:", countError);
    setQuizMsg(`Clear failed: ${countError.message}`);
    return;
  }

  if (!attemptCount) {
    setQuizMsg(`No daily results found in ${categoryName}.`);
    return;
  }

  setQuizMsg("Clearing daily results...");
  for (let index = 0; index < sessionIds.length; index += 100) {
    const deleteSessionIds = sessionIds.slice(index, index + 100);
    const { error } = await supabase.from("attempts").delete().in("test_session_id", deleteSessionIds);
    if (error) {
      console.error("clear daily results error:", error);
      setQuizMsg(`Clear failed: ${error.message}`);
      return;
    }
  }

  for (let index = 0; index < sessionIds.length; index += 100) {
    const deleteSessionIds = sessionIds.slice(index, index + 100);
    const { error } = await supabase.from("test_sessions").delete().in("id", deleteSessionIds);
    if (error) {
      console.error("clear daily sessions delete error:", error);
      setQuizMsg(`Clear failed: ${error.message}`);
      return;
    }
  }

  if (sessionDetail.type === "daily" && sessionDetail.sessionId && sessionIds.includes(sessionDetail.sessionId)) {
    closeSessionDetail();
  }
  if (typeof fetchTestSessions === "function") {
    await fetchTestSessions();
  }
  if (typeof fetchTests === "function") {
    await fetchTests();
  }
  if (typeof fetchStudentAttempts === "function" && selectedStudentId) {
    await fetchStudentAttempts(selectedStudentId);
  }
  if (typeof fetchAttempts === "function") {
    await fetchAttempts();
  } else {
    await runSearch("daily");
  }
  await recordAuditEvent({
    actionType: "delete",
    entityType: "daily_results",
    entityId: `daily-results:${categoryName}:${Date.now()}`,
    summary: `Cleared daily results in ${categoryName} (${attemptCount} records).`,
    metadata: {
      category: categoryName,
      deleted_result_count: attemptCount,
      session_count: sessionIds.length,
      deleted_session_count: sessionIds.length,
    },
  });
  setQuizMsg(`Cleared ${attemptCount} daily result record${attemptCount === 1 ? "" : "s"} and ${sessionIds.length} result session${sessionIds.length === 1 ? "" : "s"} from ${categoryName}.`);
}

export async function openPreviewAction(context, testVersion) {
  const {
    setPreviewOpen,
    setPreviewTest,
    setPreviewSession,
    setPreviewReplacementPool,
    setPreviewReplacementDrafts,
    setPreviewReplacementSavingId,
    setPreviewReplacementMsg,
    setPreviewAnswers,
    setPreviewMsg,
    fetchQuestionsForVersionWithFallback,
    supabase,
    mapDbQuestion,
    setPreviewQuestions,
  } = context;

  setPreviewOpen(true);
  setPreviewTest(testVersion);
  setPreviewSession(null);
  setPreviewReplacementPool([]);
  setPreviewReplacementDrafts({});
  setPreviewReplacementSavingId("");
  setPreviewReplacementMsg("");
  setPreviewAnswers({});
  setPreviewMsg("Loading...");
  const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, testVersion);
  if (error) {
    console.error("preview questions error:", error);
    setPreviewQuestions([]);
    setPreviewMsg(`Load failed: ${error.message}`);
    return;
  }
  const list = (data ?? []).map(mapDbQuestion);
  setPreviewQuestions(list);
  setPreviewMsg(list.length ? "" : "No questions.");
}

export async function openSessionPreviewAction(context, session) {
  const {
    setPreviewOpen,
    setPreviewSession,
    setPreviewTest,
    setPreviewReplacementPool,
    setPreviewReplacementDrafts,
    setPreviewReplacementSavingId,
    setPreviewReplacementMsg,
    setPreviewAnswers,
    setPreviewMsg,
    fetchQuestionsForVersionWithFallback,
    supabase,
    mapDbQuestion,
    setPreviewQuestions,
    isGeneratedDailySessionVersion,
    fetchQuestionsForVersionsWithFallback,
  } = context;

  if (!session?.problem_set_id) return;
  setPreviewOpen(true);
  setPreviewSession(session);
  setPreviewTest(session.title || session.problem_set_id);
  setPreviewReplacementPool([]);
  setPreviewReplacementDrafts({});
  setPreviewReplacementSavingId("");
  setPreviewReplacementMsg("");
  setPreviewAnswers({});
  setPreviewMsg("Loading...");

  const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, session.problem_set_id);
  if (error) {
    console.error("session preview questions error:", error);
    setPreviewQuestions([]);
    setPreviewMsg(`Load failed: ${error.message}`);
    return;
  }

  const list = (data ?? []).map(mapDbQuestion);
  setPreviewQuestions(list);
  setPreviewMsg(list.length ? "" : "No questions.");

  if (!isGeneratedDailySessionVersion(session.problem_set_id)) {
    return;
  }

  const sourceSetIds = Array.from(
    new Set(list.map((question) => question.sourceVersion).filter(Boolean))
  );
  if (!sourceSetIds.length) return;

  const { data: sourceData, error: sourceError } = await fetchQuestionsForVersionsWithFallback(
    supabase,
    sourceSetIds
  );
  if (sourceError) {
    console.error("session preview source questions error:", sourceError);
    setPreviewReplacementMsg(`Replacement load failed: ${sourceError.message}`);
    return;
  }

  const replacementPool = (sourceData ?? []).map((row) => {
    const mapped = mapDbQuestion(row);
    return {
      ...mapped,
      sourceVersion: row.test_version,
      sourceQuestionId: row.question_id,
    };
  });
  setPreviewReplacementPool(replacementPool);
}

export async function importDailyResultsGoogleSheetsCsvAction(context, file, targetCategoryName = "") {
  const {
    dailyTests,
    testSessions,
    isRetakeSessionTitle,
    setQuizMsg,
    showResultsImportResultStatus,
    showResultsImportLoadingStatus,
    parseSeparatedRows,
    detectDelimiter,
    formatSlashDateShortYear,
    normalizeLookupValue,
    parseSlashDateShortYearToIso,
    hasDailyResultValues,
    promptDailyResultsImportConflict,
    buildImportedResultTestVersion,
    ensureTestRecord,
    activeSchoolId,
    supabase,
    createImportedStudentMatcher,
    sortedStudents,
    students,
    rowHasCsvValues,
    normalizeCsvValue,
    parsePercentCell,
    buildImportedSummaryAnswersJson,
    dedupeImportedAttemptPayloads,
    replaceImportedSummaryAttempts,
    fetchTestSessions,
    fetchTests,
    fetchStudents,
    fetchAttempts,
    setDailyResultsCategory,
    runSearch,
    recordAuditEvent,
    resultsImportInputRef,
  } = context;

  if (!file) return;
  const categoryName = String(targetCategoryName ?? "").trim();
  if (!categoryName) {
    const message = "Import failed: select a daily test category first.";
    setQuizMsg(message);
    showResultsImportResultStatus("daily", message, "error");
    return;
  }
  const testsForCategory = (dailyTests ?? []).filter(
    (test) => String(test.title ?? "").trim() === categoryName
  );
  const testByVersion = new Map((testsForCategory ?? []).map((test) => [test.version, test]));
  const importSessions = (testSessions ?? [])
    .filter((session) => testByVersion.has(session.problem_set_id))
    .filter((session) => !isRetakeSessionTitle(session.title))
    .map((session) => ({
      ...session,
      linkedTest: testByVersion.get(session.problem_set_id) ?? null,
    }));
  setQuizMsg("Importing CSV...");
  showResultsImportLoadingStatus("daily", "Reading uploaded CSV...");
  try {
    const text = await file.text();
    const rows = parseSeparatedRows(text, detectDelimiter(text));
    if (rows.length < 4) {
      const message = "Import failed: CSV format is not recognized.";
      setQuizMsg(message);
      showResultsImportResultStatus("daily", message, "error");
      return;
    }

    const sessionKeyMap = new Map();
    const uniqueTitleMap = new Map();
    importSessions.forEach((session, index) => {
      const title = String(session.title ?? session.problem_set_id ?? "").trim();
      const dateKey = formatSlashDateShortYear(session.starts_at || session.created_at);
      sessionKeyMap.set(`${normalizeLookupValue(title)}::${dateKey}`, session);
      const titleKey = normalizeLookupValue(title);
      if (!uniqueTitleMap.has(titleKey)) uniqueTitleMap.set(titleKey, []);
      uniqueTitleMap.get(titleKey).push({ session, index });
    });

    const existingResultTitles = new Set(
      importSessions
        .map((session) => String(session?.title ?? session?.problem_set_id ?? "").trim())
        .filter(Boolean)
    );
    const csvColumns = [];
    for (let col = 5; col < Math.max(rows[0]?.length ?? 0, rows[1]?.length ?? 0); col += 1) {
      const rawTitle = String(rows[0]?.[col] ?? "").trim();
      const rawDate = String(rows[1]?.[col] ?? "").trim();
      if (!rawTitle) continue;
      csvColumns.push({
        columnIndex: csvColumns.length,
        colIndex: col,
        importTitle: rawTitle,
        importDateCell: rawDate,
        importDateIso: parseSlashDateShortYearToIso(rawDate),
        session: null,
        linkedTest: null,
      });
    }

    const populatedCsvColumns = csvColumns.filter((column) => hasDailyResultValues(rows, column.colIndex, 3));

    if (!populatedCsvColumns.length) {
      const message = "Import failed: no daily result columns were found in the CSV.";
      setQuizMsg(message);
      showResultsImportResultStatus("daily", message, "error");
      return;
    }

    const duplicateTitles = populatedCsvColumns
      .map((column) => String(column.importTitle ?? "").trim())
      .filter((title, index, list) => title && list.indexOf(title) === index && existingResultTitles.has(title));
    let selectedColumns = populatedCsvColumns;
    let overwriteSessionIds = [];

    if (duplicateTitles.length) {
      showResultsImportResultStatus("daily", "Duplicate test titles found. Choose how to continue.", "info", "Daily Results Import Warning");
      const importChoice = await promptDailyResultsImportConflict(duplicateTitles);
      if (importChoice === "cancel") {
        const message = "Import cancelled.";
        setQuizMsg(message);
        showResultsImportResultStatus("daily", message, "info", "Daily Results Import Cancelled");
        return;
      }
      if (importChoice === "new_only") {
        selectedColumns = populatedCsvColumns.filter((column) => !existingResultTitles.has(String(column.importTitle ?? "").trim()));
        if (!selectedColumns.length) {
          const message = "Import skipped: all CSV test titles already exist in the current category, and only new tests was selected.";
          setQuizMsg(message);
          showResultsImportResultStatus("daily", message, "info");
          return;
        }
      } else {
        overwriteSessionIds = Array.from(new Set(
          importSessions
            .filter((session) => duplicateTitles.includes(String(session.title ?? "").trim()))
            .map((session) => session.id)
        ));
      }
    }

    showResultsImportLoadingStatus("daily", `Preparing daily result sessions for ${categoryName}...`);
    selectedColumns.forEach((column) => {
      const titleKey = normalizeLookupValue(column.importTitle);
      const matchedByKey = sessionKeyMap.get(`${titleKey}::${column.importDateCell}`);
      const matchedByTitle = uniqueTitleMap.get(titleKey) ?? [];
      const session = matchedByKey ?? matchedByTitle[0]?.session ?? null;
      if (session?.id) {
        column.session = session;
        column.linkedTest = session.linkedTest ?? testByVersion.get(session.problem_set_id) ?? null;
        return;
      }
      const linkedTest = testsForCategory[column.columnIndex] ?? testsForCategory[0] ?? null;
      if (linkedTest?.version) column.linkedTest = linkedTest;
    });

    const columnsMissingLinkedTest = selectedColumns.filter((column) => !column.session?.id && !column.linkedTest?.version);
    for (let index = 0; index < columnsMissingLinkedTest.length; index += 1) {
      const column = columnsMissingLinkedTest[index];
      const version = buildImportedResultTestVersion("daily", categoryName, index);
      const ensure = await ensureTestRecord(version, categoryName, "daily", 0.8, activeSchoolId);
      if (!ensure.ok) {
        const message = `Import failed: ${ensure.message}`;
        setQuizMsg(message);
        showResultsImportResultStatus("daily", message, "error");
        return;
      }
      column.linkedTest = {
        version,
        title: categoryName,
        type: "daily",
        pass_rate: 0.8,
        question_count: 0,
      };
    }

    const columnsToCreate = selectedColumns.filter((column) => !column.session?.id);
    if (columnsToCreate.length) {
      const createPayloads = columnsToCreate.map((column) => {
        const sessionDateIso = column.importDateIso
          ? new Date(`${column.importDateIso}T00:00:00`).toISOString()
          : new Date().toISOString();
        return {
          school_id: activeSchoolId,
          problem_set_id: column.linkedTest.version,
          title: column.importTitle,
          session_category: categoryName,
          starts_at: sessionDateIso,
          ends_at: sessionDateIso,
          time_limit_min: null,
          is_published: false,
          show_answers: false,
          allow_multiple_attempts: false,
        };
      });
      const createdSessions = [];
      for (const payloadChunk of chunkItems(createPayloads, TEST_SESSION_IMPORT_BATCH_SIZE)) {
        const { data: chunkSessions, error: createError } = await supabase
          .from("test_sessions")
          .insert(payloadChunk)
          .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, allow_multiple_attempts, created_at");
        if (createError) {
          const message = `Import failed: ${createError.message}`;
          setQuizMsg(message);
          showResultsImportResultStatus("daily", message, "error");
          return;
        }
        createdSessions.push(...(chunkSessions ?? []));
      }
      createdSessions.forEach((sessionRow, index) => {
        const column = columnsToCreate[index];
        if (!column) return;
        column.session = {
          retake_source_session_id: null,
          retake_release_scope: "all",
          ...sessionRow,
          linkedTest: column.linkedTest,
        };
      });
    }

    let studentRoster = Array.isArray(sortedStudents) && sortedStudents.length
      ? sortedStudents
      : (Array.isArray(students) ? students : []);

    // Auto-load students if roster is empty
    if (!studentRoster.length && fetchStudents) {
      showResultsImportLoadingStatus("daily", "Loading student roster...");
      const fetchedStudents = await fetchStudents();
      studentRoster = Array.isArray(fetchedStudents) && fetchedStudents.length
        ? fetchedStudents
        : studentRoster;
    }

    logImportStudentRoster("daily-results", studentRoster);
    const matchStudent = createImportedStudentMatcher(studentRoster);
    const payloads = [];
    const unmatchedRows = [];
    showResultsImportLoadingStatus("daily", `Matching students and saving imported results into ${categoryName}...`);

    for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      if (!rowHasCsvValues(row)) continue;
      const sectionMarker = normalizeLookupValue(row[3]);
      if (sectionMarker.startsWith("failed students") || sectionMarker.startsWith("absent students")) break;

      const rowNumberValue = normalizeCsvValue(row[1]);
      const student = matchStudent({
        rowNumber: Number(rowNumberValue),
        name: row[2],
        section: row[3],
        email: "",
      });
      if (!student?.id) {
        unmatchedRows.push({
          rowNumber: rowIndex + 1,
          rowNumberValue,
          name: String(row[2] ?? "").trim(),
          section: String(row[3] ?? "").trim(),
          email: "",
        });
        continue;
      }

      selectedColumns.forEach((column) => {
        const { colIndex, session } = column;
        const rate = parsePercentCell(row[colIndex]);
        if (rate == null) return;
        payloads.push({
          student_id: student.id,
          display_name: student.display_name ?? null,
          student_code: student.student_code ?? null,
          test_version: session.problem_set_id,
          test_session_id: session.id,
          correct: 0,
          total: 0,
          score_rate: rate,
          started_at: session.starts_at ?? null,
          ended_at: session.ends_at ?? session.starts_at ?? new Date().toISOString(),
          answers_json: buildImportedSummaryAnswersJson("daily_results_csv", {
            imported_test_title: column.importTitle,
            imported_test_date: column.importDateIso || null,
            imported_rate: rate,
            imported_csv_index: column.columnIndex,
            imported_category: categoryName,
          }),
          tab_left_count: 0,
        });
      });
    }

    const dedupedPayloads = dedupeImportedAttemptPayloads(payloads);
    if (!dedupedPayloads.length) {
      const unmatchedLog = logUnmatchedImportRows("daily-results", unmatchedRows);
      const message = unmatchedLog
        ? `Import failed: no daily result rows were recognized. Unmatched rows: ${unmatchedLog}`
        : "Import failed: no daily result rows were recognized.";
      setQuizMsg(message);
      showResultsImportResultStatus("daily", message, "error");
      return;
    }

    if (unmatchedRows.length) {
      logUnmatchedImportRows("daily-results", unmatchedRows);
    }

    const result = await replaceImportedSummaryAttempts(dedupedPayloads, {
      overwriteSessionIds,
    });
    if (!result.ok) {
      const message = `Import failed: ${result.message}`;
      setQuizMsg(message);
      showResultsImportResultStatus("daily", message, "error");
      return;
    }

    await fetchTestSessions();
    await fetchTests();
    setDailyResultsCategory(categoryName);
    if (typeof fetchAttempts === "function") {
      await fetchAttempts();
    } else {
      await runSearch("daily");
    }
    const skippedExistingCount = duplicateTitles.length && !overwriteSessionIds.length
      ? duplicateTitles.length
      : 0;
    const createdSessionCount = columnsToCreate.length;
    const message =
      `Imported ${result.inserted} daily result entr${result.inserted === 1 ? "y" : "ies"}`
      + (createdSessionCount ? `, created ${createdSessionCount} new result session${createdSessionCount === 1 ? "" : "s"}` : "")
      + (overwriteSessionIds.length ? `, replaced ${overwriteSessionIds.length} existing test result set${overwriteSessionIds.length === 1 ? "" : "s"}` : "")
      + (skippedExistingCount ? `, skipped ${skippedExistingCount} existing test title${skippedExistingCount === 1 ? "" : "s"}` : "")
      + (unmatchedRows.length ? ` (${unmatchedRows.length} row${unmatchedRows.length === 1 ? "" : "s"} unmatched).` : ".");
    await recordAuditEvent({
      actionType: "import",
      entityType: "results_import",
      entityId: `daily:${categoryName}:${Date.now()}`,
      summary: `Imported daily results into ${categoryName} (${result.inserted} entries).`,
      metadata: {
        test_type: "daily",
        category: categoryName,
        imported_entry_count: result.inserted,
        created_session_count: createdSessionCount,
      },
    });
    setQuizMsg(message);
    showResultsImportResultStatus("daily", message, "success");
    if (fetchAttempts) {
      await fetchAttempts();
    }
  } catch (error) {
    const message = `Import failed: ${error instanceof Error ? error.message : error}`;
    setQuizMsg(message);
    showResultsImportResultStatus("daily", message, "error");
  } finally {
    if (resultsImportInputRef.current) resultsImportInputRef.current.value = "";
  }
}

export async function importModelResultsGoogleSheetsCsvAction(context, file, targetCategoryName = "") {
  const {
    modelTests,
    testSessions,
    isRetakeSessionTitle,
    setQuizMsg,
    showResultsImportResultStatus,
    showResultsImportLoadingStatus,
    parseSeparatedRows,
    detectDelimiter,
    normalizeLookupValue,
    parseSlashDateShortYearToIso,
    parsePercentCell,
    parseScoreFractionCell,
    formatSlashDateShortYear,
    hasModelResultValues,
    promptModelResultsImportConflict,
    buildImportedResultTestVersion,
    ensureTestRecord,
    activeSchoolId,
    supabase,
    createImportedStudentMatcher,
    sortedStudents,
    students,
    rowHasCsvValues,
    normalizeCsvValue,
    buildImportedSummaryAnswersJson,
    normalizeImportedModelSectionTitle,
    dedupeImportedAttemptPayloads,
    replaceImportedSummaryAttempts,
    fetchTestSessions,
    fetchTests,
    fetchStudents,
    fetchAttempts,
    setModelResultsCategory,
    runSearch,
    recordAuditEvent,
    resultsImportInputRef,
  } = context;

  if (!file) return;
  const categoryName = String(targetCategoryName ?? "").trim();
  if (!categoryName) {
    const message = "Import failed: select a model test category first.";
    setQuizMsg(message);
    showResultsImportResultStatus("mock", message, "error");
    return;
  }
  const testsForCategory = (modelTests ?? []).filter(
    (test) => String(test.title ?? "").trim() === categoryName
  );
  const testByVersion = new Map((testsForCategory ?? []).map((test) => [test.version, test]));
  const importSessions = (testSessions ?? [])
    .filter((session) => testByVersion.has(session.problem_set_id))
    .filter((session) => !isRetakeSessionTitle(session.title))
    .map((session) => ({
      ...session,
      linkedTest: testByVersion.get(session.problem_set_id) ?? null,
    }));
  setQuizMsg("Importing CSV...");
  showResultsImportLoadingStatus("mock", "Reading uploaded CSV...");
  try {
    const text = await file.text();
    const rows = parseSeparatedRows(text, detectDelimiter(text));
    if (rows.length < 5) {
      const message = "Import failed: CSV format is not recognized.";
      setQuizMsg(message);
      showResultsImportResultStatus("mock", message, "error");
      return;
    }

    const headerRowIndex = rows.findIndex((row) => {
      const normalized = (row ?? []).map((cell) => normalizeLookupValue(cell));
      return normalized.includes("no.") && normalized.includes("student name");
    });
    if (headerRowIndex < 0 || rows.length < headerRowIndex + 5) {
      const message = "Import failed: CSV header rows are not recognized.";
      setQuizMsg(message);
      showResultsImportResultStatus("mock", message, "error");
      return;
    }
    const titleRowIndex = headerRowIndex;
    const sectionRowIndex = headerRowIndex + 1;
    const dateRowIndex = headerRowIndex + 2;
    const sampleValueRowIndex = headerRowIndex + 3;
    const dataStartRowIndex = headerRowIndex + 4;

    const sessionKeyMap = new Map();
    const uniqueTitleMap = new Map();
    importSessions.forEach((session, index) => {
      const title = String(session.title ?? session.problem_set_id ?? "").trim();
      const dateKey = formatSlashDateShortYear(session.starts_at || session.created_at);
      sessionKeyMap.set(`${normalizeLookupValue(title)}::${dateKey}`, session);
      const titleKey = normalizeLookupValue(title);
      if (!uniqueTitleMap.has(titleKey)) uniqueTitleMap.set(titleKey, []);
      uniqueTitleMap.get(titleKey).push({ session, index });
    });

    const existingResultTitles = new Set(
      importSessions
        .map((session) => String(session?.title ?? session?.problem_set_id ?? "").trim())
        .filter(Boolean)
    );

    const csvBlocks = [];
    let currentBlock = null;
    const maxHeaderColumns = Math.max(
      rows[titleRowIndex]?.length ?? 0,
      rows[sectionRowIndex]?.length ?? 0,
      rows[dateRowIndex]?.length ?? 0,
      rows[sampleValueRowIndex]?.length ?? 0
    );
    for (let col = 5; col < maxHeaderColumns; col += 1) {
      const titleCell = String(rows[titleRowIndex]?.[col] ?? "").trim();
      if (titleCell) {
        currentBlock = {
          blockIndex: csvBlocks.length,
          importTitle: titleCell,
          importDateCell: String(rows[dateRowIndex]?.[col] ?? "").trim(),
          importDateIso: parseSlashDateShortYearToIso(rows[dateRowIndex]?.[col]),
          sections: [],
          total: null,
          blockStartColumnIndex: col,
          session: null,
          linkedTest: null,
        };
        csvBlocks.push(currentBlock);
      }
      if (!currentBlock) continue;
      const sectionCell = String(rows[sectionRowIndex]?.[col] ?? "").trim();
      if (!sectionCell || sectionCell === "Ranking") continue;
      if (!currentBlock.importDateCell) {
        currentBlock.importDateCell = String(rows[dateRowIndex]?.[col] ?? "").trim();
      }
      if (!currentBlock.importDateIso) {
        currentBlock.importDateIso = parseSlashDateShortYearToIso(rows[dateRowIndex]?.[col]);
      }
      if (sectionCell === "Total") {
        currentBlock.total = {
          rateColumnIndex: col,
          scoreColumnIndex: col + 1,
        };
        continue;
      }
      currentBlock.sections.push({
        sectionTitle: sectionCell,
        rateColumnIndex: col,
        scoreColumnIndex: col + 1,
      });
    }

    csvBlocks.forEach((block, blockIndex) => {
      if (block.total) return;
      const nextBlockStart = csvBlocks[blockIndex + 1]?.blockStartColumnIndex ?? maxHeaderColumns;
      let inferredTotal = null;
      for (let col = block.blockStartColumnIndex; col < nextBlockStart - 1; col += 1) {
        const percentValue = rows[sampleValueRowIndex]?.[col];
        const scoreValue = rows[sampleValueRowIndex]?.[col + 1];
        if (parsePercentCell(percentValue) == null) continue;
        if (!parseScoreFractionCell(scoreValue)) continue;
        inferredTotal = {
          rateColumnIndex: col,
          scoreColumnIndex: col + 1,
        };
      }
      if (inferredTotal) block.total = inferredTotal;
    });

    const mappedBlocks = csvBlocks.filter((block) => block.total);
    const populatedBlocks = mappedBlocks.filter((block) => hasModelResultValues(rows, block, dataStartRowIndex));
    if (!populatedBlocks.length) {
      const message = "Import failed: no model result columns were found in the CSV.";
      setQuizMsg(message);
      showResultsImportResultStatus("mock", message, "error");
      return;
    }

    const duplicateTitles = populatedBlocks
      .map((block) => String(block.importTitle ?? "").trim())
      .filter((title, index, list) => title && list.indexOf(title) === index && existingResultTitles.has(title));
    let selectedBlocks = populatedBlocks;

    if (duplicateTitles.length) {
      showResultsImportResultStatus("mock", "Duplicate test titles found. Choose how to continue.", "info", "Model Results Import Warning");
      const importChoice = await promptModelResultsImportConflict(duplicateTitles);
      if (importChoice === "cancel") {
        const message = "Import cancelled.";
        setQuizMsg(message);
        showResultsImportResultStatus("mock", message, "info", "Model Results Import Cancelled");
        return;
      }
      if (importChoice === "new_only") {
        selectedBlocks = populatedBlocks.filter((block) => !existingResultTitles.has(String(block.importTitle ?? "").trim()));
        if (!selectedBlocks.length) {
          const message = "Import skipped: all CSV test titles already exist in the current results, and only new tests was selected.";
          setQuizMsg(message);
          showResultsImportResultStatus("mock", message, "info");
          return;
        }
      }
    }

    showResultsImportLoadingStatus("mock", `Preparing model result sessions for ${categoryName}...`);
    selectedBlocks.forEach((block) => {
      const titleKey = normalizeLookupValue(block.importTitle);
      const matchedByKey = sessionKeyMap.get(`${titleKey}::${block.importDateCell}`);
      const matchedByTitle = uniqueTitleMap.get(titleKey) ?? [];
      const session = matchedByKey ?? matchedByTitle[0]?.session ?? null;
      if (session?.id) {
        block.session = session;
        block.linkedTest = session.linkedTest ?? testByVersion.get(session.problem_set_id) ?? null;
        return;
      }
      const linkedTest = testsForCategory[block.blockIndex] ?? null;
      if (linkedTest?.version) block.linkedTest = linkedTest;
    });

    const blocksMissingLinkedTest = selectedBlocks.filter((block) => !block.session?.id && !block.linkedTest?.version);
    for (let index = 0; index < blocksMissingLinkedTest.length; index += 1) {
      const block = blocksMissingLinkedTest[index];
      const version = buildImportedResultTestVersion("mock", categoryName, index);
      const ensure = await ensureTestRecord(version, categoryName, "mock", 0.8, activeSchoolId);
      if (!ensure.ok) {
        const message = `Import failed: ${ensure.message}`;
        setQuizMsg(message);
        showResultsImportResultStatus("mock", message, "error");
        return;
      }
      block.linkedTest = {
        version,
        title: categoryName,
        type: "mock",
        pass_rate: 0.8,
        question_count: 0,
      };
    }

    const blocksToCreate = selectedBlocks.filter((block) => !block.session?.id);
    if (blocksToCreate.length) {
      const createPayloads = blocksToCreate.map((block) => {
        const sessionDateIso = block.importDateIso
          ? new Date(`${block.importDateIso}T00:00:00`).toISOString()
          : new Date().toISOString();
        return {
          school_id: activeSchoolId,
          problem_set_id: block.linkedTest.version,
          title: block.importTitle,
          starts_at: sessionDateIso,
          ends_at: sessionDateIso,
          time_limit_min: null,
          is_published: false,
          show_answers: false,
          allow_multiple_attempts: false,
        };
      });
      const createdSessions = [];
      for (const payloadChunk of chunkItems(createPayloads, TEST_SESSION_IMPORT_BATCH_SIZE)) {
        const { data: chunkSessions, error: createError } = await supabase
          .from("test_sessions")
          .insert(payloadChunk)
          .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, allow_multiple_attempts, created_at");
        if (createError) {
          const message = `Import failed: ${createError.message}`;
          setQuizMsg(message);
          showResultsImportResultStatus("mock", message, "error");
          return;
        }
        createdSessions.push(...(chunkSessions ?? []));
      }
      createdSessions.forEach((sessionRow, index) => {
        const block = blocksToCreate[index];
        if (!block) return;
        block.session = {
          retake_source_session_id: null,
          retake_release_scope: "all",
          ...sessionRow,
          linkedTest: block.linkedTest,
        };
      });
    }

    const overwriteSessionIds = Array.from(
      new Set(
        selectedBlocks
          .filter((block) => existingResultTitles.has(String(block.importTitle ?? "").trim()))
          .map((block) => block.session?.id)
          .filter(Boolean)
      )
    );

    let studentRoster = Array.isArray(sortedStudents) && sortedStudents.length
      ? sortedStudents
      : (Array.isArray(students) ? students : []);

    // Auto-load students if roster is empty
    if (!studentRoster.length && fetchStudents) {
      showResultsImportLoadingStatus("mock", "Loading student roster...");
      const fetchedStudents = await fetchStudents();
      studentRoster = Array.isArray(fetchedStudents) && fetchedStudents.length
        ? fetchedStudents
        : studentRoster;
    }

    logImportStudentRoster("model-results", studentRoster);
    const matchStudent = createImportedStudentMatcher(studentRoster);
    const payloads = [];
    const unmatchedRows = [];
    showResultsImportLoadingStatus("mock", `Matching students and saving imported results into ${categoryName}...`);

    for (let rowIndex = dataStartRowIndex; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      if (!rowHasCsvValues(row)) continue;
      const sectionMarker = normalizeLookupValue(row[3]);
      if (sectionMarker.startsWith("failed students") || sectionMarker.startsWith("absent students")) break;

      const rowNumberValue = normalizeCsvValue(row[1]);
      const student = matchStudent({
        rowNumber: Number(rowNumberValue),
        name: row[2],
        section: row[3],
        email: "",
      });
      if (!student?.id) {
        unmatchedRows.push({
          rowNumber: rowIndex + 1,
          rowNumberValue,
          name: String(row[2] ?? "").trim(),
          section: String(row[3] ?? "").trim(),
          email: "",
        });
        continue;
      }

      selectedBlocks.forEach(({ session, total: totalColumns, sections: blockSections }) => {
        const rate = parsePercentCell(row[totalColumns.rateColumnIndex]);
        if (rate == null) return;
        const score = parseScoreFractionCell(row[totalColumns.scoreColumnIndex]);
        const total = score?.total ?? Math.max(0, Number(session?.linkedTest?.question_count ?? 0));
        const correct = score?.correct ?? (total > 0 ? Math.round(rate * total) : 0);
        const mainSectionSummary = blockSections
          .map((section) => {
            const sectionRate = parsePercentCell(row[section.rateColumnIndex]);
            const sectionScore = parseScoreFractionCell(row[section.scoreColumnIndex]);
            if (sectionRate == null && !sectionScore) return null;
            const sectionTotal = Number(sectionScore?.total ?? 0);
            const sectionCorrect = Number(
              sectionScore?.correct
              ?? (sectionRate != null && sectionTotal > 0 ? Math.round(sectionRate * sectionTotal) : 0)
            );
            return {
              section: normalizeImportedModelSectionTitle(section.sectionTitle),
              correct: Number.isFinite(sectionCorrect) ? sectionCorrect : 0,
              total: Number.isFinite(sectionTotal) ? sectionTotal : 0,
              rate: sectionRate != null
                ? sectionRate
                : (sectionTotal > 0 ? sectionCorrect / sectionTotal : 0),
            };
          })
          .filter(Boolean);
        payloads.push({
          student_id: student.id,
          display_name: student.display_name ?? null,
          student_code: student.student_code ?? null,
          test_version: session.problem_set_id,
          test_session_id: session.id,
          correct,
          total,
          score_rate: rate,
          started_at: session.starts_at ?? null,
          ended_at: session.ends_at ?? session.starts_at ?? new Date().toISOString(),
          answers_json: buildImportedSummaryAnswersJson("model_results_csv", {
            imported_test_title: session.title || block.importTitle || "",
            imported_test_date: block.importDateIso || null,
            imported_rate: rate,
            main_section_summary: mainSectionSummary,
            imported_csv_index: block.blockIndex,
          }),
          tab_left_count: 0,
        });
      });
    }

    const dedupedPayloads = dedupeImportedAttemptPayloads(payloads);
    if (!dedupedPayloads.length) {
      const unmatchedLog = logUnmatchedImportRows("model-results", unmatchedRows);
      const message = unmatchedLog
        ? `Import failed: no model result rows were recognized. Unmatched rows: ${unmatchedLog}`
        : "Import failed: no model result rows were recognized.";
      setQuizMsg(message);
      showResultsImportResultStatus("mock", message, "error");
      return;
    }

    if (unmatchedRows.length) {
      logUnmatchedImportRows("model-results", unmatchedRows);
    }

    const result = await replaceImportedSummaryAttempts(dedupedPayloads, {
      overwriteSessionIds,
    });
    if (!result.ok) {
      const message = `Import failed: ${result.message}`;
      setQuizMsg(message);
      showResultsImportResultStatus("mock", message, "error");
      return;
    }

    await fetchTestSessions();
    await fetchTests();
    setModelResultsCategory(categoryName);
    if (typeof fetchAttempts === "function") {
      await fetchAttempts();
    } else {
      await runSearch("mock");
    }
    const skippedExistingCount = duplicateTitles.length && !overwriteSessionIds.length
      ? duplicateTitles.length
      : 0;
    const createdSessionCount = blocksToCreate.length;
    const message =
      `Imported ${result.inserted} model result entr${result.inserted === 1 ? "y" : "ies"}`
      + (createdSessionCount ? `, created ${createdSessionCount} new result session${createdSessionCount === 1 ? "" : "s"}` : "")
      + (overwriteSessionIds.length ? `, replaced ${overwriteSessionIds.length} existing test result set${overwriteSessionIds.length === 1 ? "" : "s"}` : "")
      + (skippedExistingCount ? `, skipped ${skippedExistingCount} existing test title${skippedExistingCount === 1 ? "" : "s"}` : "")
      + (unmatchedRows.length ? ` (${unmatchedRows.length} row${unmatchedRows.length === 1 ? "" : "s"} unmatched).` : ".");
    await recordAuditEvent({
      actionType: "import",
      entityType: "results_import",
      entityId: `mock:${categoryName}:${Date.now()}`,
      summary: `Imported model results into ${categoryName} (${result.inserted} entries).`,
      metadata: {
        test_type: "mock",
        category: categoryName,
        imported_entry_count: result.inserted,
        created_session_count: createdSessionCount,
      },
    });
    setQuizMsg(message);
    showResultsImportResultStatus("mock", message, "success");
    if (fetchAttempts) {
      await fetchAttempts();
    }
  } catch (error) {
    const message = `Import failed: ${error instanceof Error ? error.message : error}`;
    setQuizMsg(message);
    showResultsImportResultStatus("mock", message, "error");
  } finally {
    if (resultsImportInputRef.current) resultsImportInputRef.current.value = "";
  }
}
