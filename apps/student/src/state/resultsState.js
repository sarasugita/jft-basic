import { supabase, publicSupabase } from "../supabaseClient";
import { QUESTION_SELECT_BASE } from "../lib/constants";
import { getErrorMessage, logSupabaseError, logUnexpectedError, isMissingTabLeftCountError } from "../lib/errorHelpers";
import {
  dedupeAttempts,
  buildLatestAttemptMapByStudent,
  getScoreRateFromAttempt,
  isImportedSummaryAttempt,
} from "../lib/attemptHelpers";
import { authState } from "./authState";
import { mapDbQuestion, fetchQuestionRowsWithFallback } from "./questionsState";
import { fetchSessionAttemptOverrides } from "./sessionOverrideState";
import { ensureTestVersionsLoaded } from "./testsState";

export let studentResultsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
  userId: "",
};

export let resultDetailState = {
  open: false,
  mode: "",
  subTab: "score",
  sectionFilter: "",
  wrongOnly: false,
  popupOpen: false,
  popupTitle: "",
  popupRows: [],
  attempt: null,
  loading: false,
  error: "",
  questionsByVersion: {},
};

export let modelRankState = {
  loading: false,
  loaded: false,
  map: {},
  totalMap: {},
};

let resultQuestionRefreshPromise = null;
let resultQuestionRefreshKey = "";

// --- Fetch functions ---

export async function fetchStudentResults() {
  if (!authState.session) return;
  if (studentResultsState.loading) return;
  studentResultsState.loading = true;
  studentResultsState.error = "";
  modelRankState.loaded = false;
  modelRankState.loading = false;
  modelRankState.map = {};
  modelRankState.totalMap = {};
  const hadData = studentResultsState.loaded && studentResultsState.list.length > 0;
  const baseFields = "id, test_version, test_session_id, correct, total, score_rate, started_at, created_at, ended_at, answers_json, tab_left_count";
  const legacyFields = "id, test_version, test_session_id, correct, total, score_rate, started_at, created_at, ended_at, answers_json";
  const pageSizes = [100, 50, 25];

  const getAttemptPageCursor = (attempt) => {
    const createdAt = String(attempt?.created_at ?? "").trim();
    const id = String(attempt?.id ?? "").trim();
    if (!createdAt || !id) return null;
    return { createdAt, id };
  };

  const buildAttemptPageQuery = (fields, cursor, includeCount, pageSize) => {
    const options = includeCount ? { count: "exact" } : undefined;
    let query = options
      ? supabase.from("attempts").select(fields, options)
      : supabase.from("attempts").select(fields);
    query = query
      .eq("student_id", authState.session.user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize);
    if (cursor?.createdAt && cursor?.id) {
      query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    }
    return query;
  };

  const fetchAllAttemptRowsWithPageSize = async (fields, pageSize) => {
    const rows = [];
    let cursor = null;
    let lastCursorKey = "";
    let totalCount = null;
    let useCount = true;
    for (let pageIndex = 0; pageIndex < 1000; pageIndex += 1) {
      const { data, error, count } = await buildAttemptPageQuery(fields, cursor, useCount, pageSize);
      if (error) return { data: rows, error, totalCount, pageSize };
      if (useCount && Number.isFinite(count)) {
        totalCount = count;
      }
      useCount = false;
      const pageRows = data ?? [];
      rows.push(...pageRows);
      if (!pageRows.length) break;
      if (totalCount != null && rows.length >= totalCount) break;
      const nextCursor = getAttemptPageCursor(pageRows[pageRows.length - 1]);
      if (!nextCursor) break;
      const nextCursorKey = `${nextCursor.createdAt}::${nextCursor.id}`;
      if (nextCursorKey === lastCursorKey) {
        console.warn("[student results] pagination cursor did not advance", {
          pageIndex,
          created_at: nextCursor.createdAt,
          id: nextCursor.id,
          pageSize,
        });
        break;
      }
      lastCursorKey = nextCursorKey;
      cursor = nextCursor;
    }
    return { data: rows, error: null, totalCount, pageSize };
  };

  const fetchAllAttemptRows = async (fields) => {
    let bestResult = { data: [], error: null, totalCount: null, pageSize: pageSizes[0] };
    for (const pageSize of pageSizes) {
      const result = await fetchAllAttemptRowsWithPageSize(fields, pageSize);
      if (result.error) return result;
      if ((result.data?.length ?? 0) > (bestResult.data?.length ?? 0)) {
        bestResult = result;
      }
      if (result.totalCount == null || (result.data?.length ?? 0) >= result.totalCount) {
        return result;
      }
    }
    if (bestResult.totalCount != null && (bestResult.data?.length ?? 0) < bestResult.totalCount) {
      console.warn("[student results] result fetch completed below exact count", {
        loaded: bestResult.data?.length ?? 0,
        expected: bestResult.totalCount,
        pageSize: bestResult.pageSize,
      });
    }
    return bestResult;
  };

  try {
    // DEBUG: get true DB row count via HEAD request (no body → max_rows cannot affect it)
    const { count: dbHeadCount, error: headCountError } = await supabase
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .eq("student_id", authState.session.user.id);

    let fetchResult = await fetchAllAttemptRows(baseFields);
    if (fetchResult.error && isMissingTabLeftCountError(fetchResult.error)) {
      fetchResult = await fetchAllAttemptRows(legacyFields);
    }
    const { data, error } = fetchResult;

    // DEBUG: compare HEAD count vs pagination count vs rows actually received
    console.log("[student results] fetch diagnostic", {
      dbHeadCount,           // true total rows in DB for this student (unaffected by max_rows)
      paginationCount: fetchResult.totalCount,  // count returned alongside first page data
      fetchedRows: data?.length ?? 0,           // rows actually collected across all pages
      dedupedRows: null,     // filled below after dedup
      headCountError: headCountError?.message ?? null,
      finalPageSize: fetchResult.pageSize,
    });

    if (error) {
      logSupabaseError("attempts fetch error", error);
      if (!hadData) {
        studentResultsState.list = [];
      }
      studentResultsState.error = getErrorMessage(error, "Failed to load results.");
      return;
    }
    studentResultsState.list = dedupeAttempts(data ?? []);
    console.log("[student results] after dedup", {
      dedupedRows: studentResultsState.list.length,
      dropped: (data?.length ?? 0) - studentResultsState.list.length,
    });
    // Ensure all test versions referenced in results are in testsState.list so
    // getAttemptTestType() can classify them and buildResultAttemptEntries()
    // doesn't silently drop attempts whose test_version wasn't in the initial fetch.
    const resultVersions = Array.from(
      new Set(studentResultsState.list.map((a) => String(a?.test_version ?? "").trim()).filter(Boolean))
    );
    await ensureTestVersionsLoaded(resultVersions);
    const importedSummaryAttempts = studentResultsState.list.filter(isImportedSummaryAttempt);
    const legacyImportedSummaryAttempts = studentResultsState.list.filter((attempt) => {
      const meta = attempt?.answers_json?.__meta ?? {};
      const source = String(meta.imported_source ?? "").trim();
      const hasLegacyMeta = Boolean(
        String(meta.imported_test_title ?? "").trim()
        || String(meta.imported_test_date ?? "").trim()
        || String(meta.imported_csv_index ?? "").trim()
        || String(meta.imported_rate ?? "").trim()
        || (Array.isArray(meta.main_section_summary) && meta.main_section_summary.length > 0)
      );
      return hasLegacyMeta && !Boolean(meta.imported_summary) && (source === "daily_results_csv" || source === "model_results_csv");
    });
    if (legacyImportedSummaryAttempts.length) {
      console.warn("[student results] legacy imported summary rows detected", {
        count: legacyImportedSummaryAttempts.length,
        sample: legacyImportedSummaryAttempts.slice(0, 5).map((attempt) => ({
          id: attempt?.id ?? "",
          test_version: attempt?.test_version ?? "",
          test_session_id: attempt?.test_session_id ?? "",
          created_at: attempt?.created_at ?? "",
          imported_source: String(attempt?.answers_json?.__meta?.imported_source ?? "").trim(),
        })),
      });
    }
    const unclassifiedImportedAttempts = importedSummaryAttempts.filter((attempt) => {
      const source = String(attempt?.answers_json?.__meta?.imported_source ?? "").trim();
      return source !== "daily_results_csv" && source !== "model_results_csv";
    });
    if (unclassifiedImportedAttempts.length) {
      console.warn("[student results] imported attempts missing expected source metadata", {
        count: unclassifiedImportedAttempts.length,
        sample: unclassifiedImportedAttempts.slice(0, 5).map((attempt) => ({
          id: attempt?.id ?? "",
          test_version: attempt?.test_version ?? "",
          created_at: attempt?.created_at ?? "",
          ended_at: attempt?.ended_at ?? "",
        })),
      });
    }
    // Questions for individual attempts are fetched lazily when a student
    // clicks into an attempt detail (see bindDailyResultsTabEvents /
    // bindModelResultsTabEvents). Prefetching every version's questions here
    // blocked the list render on slow connections and could fail silently.
    studentResultsState.loaded = true;
    await fetchSessionAttemptOverrides();
  } catch (error) {
    logUnexpectedError("attempts fetch failed", error);
    if (!hadData) {
      studentResultsState.list = [];
    }
    studentResultsState.error = getErrorMessage(error, "Failed to load results.");
  } finally {
    studentResultsState.loaded = true;
    studentResultsState.loading = false;
  }
}

export async function fetchModelRanks(attempts) {
  if (modelRankState.loading || modelRankState.loaded) return;
  const sessionIds = Array.from(
    new Set((attempts ?? []).map((a) => a.test_session_id).filter(Boolean))
  );
  if (!sessionIds.length) {
    modelRankState.loaded = true;
    return;
  }
  modelRankState.loading = true;
  const map = { ...modelRankState.map };
  const totalMap = { ...modelRankState.totalMap };
  try {
    for (const sessionId of sessionIds) {
      try {
        const { data, error } = await supabase
          .from("attempts")
          .select("id, student_id, score_rate, correct, total, created_at, ended_at")
          .eq("test_session_id", sessionId);
        if (error) {
          logSupabaseError("model rank fetch error", error);
          continue;
        }
        const list = Array.from(buildLatestAttemptMapByStudent(data).values()).sort(
          (a, b) => getScoreRateFromAttempt(b) - getScoreRateFromAttempt(a)
        );
        list.forEach((row, idx) => {
          if (row?.id) {
            map[row.id] = idx + 1;
            totalMap[row.id] = list.length;
          }
        });
      } catch (error) {
        logUnexpectedError("model rank fetch failed", error);
      }
    }
    modelRankState.map = map;
    modelRankState.totalMap = totalMap;
  } finally {
    modelRankState.loading = false;
    modelRankState.loaded = true;
  }
}

export async function fetchQuestionsForDetail(version) {
  return fetchQuestionsForDetailWithOptions(version);
}

export async function fetchQuestionsForDetailWithOptions(version, options = {}) {
  const { silent = false, force = false } = options;
  if (!version) return [];
  const versionKey = String(version).trim();
  if (!versionKey) return [];
  if (!force && Object.prototype.hasOwnProperty.call(resultDetailState.questionsByVersion, versionKey)) {
    if (!silent) {
      resultDetailState.loading = false;
      resultDetailState.error = "";
    }
    return resultDetailState.questionsByVersion[versionKey];
  }
  if (!silent) {
    resultDetailState.loading = true;
    resultDetailState.error = "";
  }
  try {
    const { data, error } = await fetchQuestionRowsWithFallback(versionKey);
    if (error) {
      logSupabaseError("result detail questions fetch error", error);
      if (!silent) {
        resultDetailState.error = getErrorMessage(error, "Failed to load questions.");
      }
      return [];
    }
    const list = (data ?? []).map((row) => mapDbQuestion(row, versionKey));
    resultDetailState.questionsByVersion = {
      ...resultDetailState.questionsByVersion,
      [versionKey]: list,
    };
    return list;
  } catch (error) {
    logUnexpectedError("result detail questions fetch failed", error);
    if (!silent) {
      resultDetailState.error = getErrorMessage(error, "Failed to load questions.");
    }
    return [];
  } finally {
    if (!silent) {
      resultDetailState.loading = false;
    }
  }
}

export async function refreshQuestionsForResultAttempts(attemptsList, options = {}) {
  const { force = false } = options;
  const versions = Array.from(
    new Set(
      (attemptsList ?? [])
        .map((attempt) => String(attempt?.test_version ?? "").trim())
        .filter(Boolean)
    )
  );
  if (!versions.length) return {};
  const refreshKey = versions.slice().sort().join("|");
  if (!force && resultQuestionRefreshPromise && resultQuestionRefreshKey === refreshKey) {
    return resultQuestionRefreshPromise;
  }
  const client = authState.session ? supabase : publicSupabase;
  resultQuestionRefreshKey = refreshKey;
  resultQuestionRefreshPromise = (async () => {
    try {
      const { data, error } = await client
        .from("questions")
        .select(`test_version, ${QUESTION_SELECT_BASE}`)
        .in("test_version", versions)
        .order("order_index", { ascending: true });
      if (error) {
        logSupabaseError("results question refresh error", error);
        return {};
      }
      const grouped = Object.fromEntries(versions.map((currentVersion) => [currentVersion, []]));
      (data ?? []).forEach((row) => {
        const currentVersion = String(row?.test_version ?? "").trim();
        if (!currentVersion || !Object.prototype.hasOwnProperty.call(grouped, currentVersion)) return;
        grouped[currentVersion].push(mapDbQuestion(row, currentVersion));
      });
      resultDetailState.questionsByVersion = {
        ...resultDetailState.questionsByVersion,
        ...grouped,
      };
      return grouped;
    } catch (error) {
      logUnexpectedError("results question refresh failed", error);
      return {};
    } finally {
      resultQuestionRefreshPromise = null;
    }
  })();
  return resultQuestionRefreshPromise;
}
