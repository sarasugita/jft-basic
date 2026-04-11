import { supabase, publicSupabase } from "../supabaseClient";
import { QUESTION_SELECT_BASE } from "../lib/constants";
import { getErrorMessage, logSupabaseError, logUnexpectedError, isMissingTabLeftCountError } from "../lib/errorHelpers";
import { dedupeAttempts, buildLatestAttemptMapByStudent, getScoreRateFromAttempt } from "../lib/attemptHelpers";
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
  try {
    let { data, error } = await supabase
      .from("attempts")
      .select("id, test_version, test_session_id, correct, total, score_rate, started_at, created_at, ended_at, answers_json, tab_left_count")
      .eq("student_id", authState.session.user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error && isMissingTabLeftCountError(error)) {
      ({ data, error } = await supabase
        .from("attempts")
        .select("id, test_version, test_session_id, correct, total, score_rate, started_at, created_at, ended_at, answers_json")
        .eq("student_id", authState.session.user.id)
        .order("created_at", { ascending: false })
        .limit(200));
    }
    if (error) {
      logSupabaseError("attempts fetch error", error);
      if (!hadData) {
        studentResultsState.list = [];
      }
      studentResultsState.error = getErrorMessage(error, "Failed to load results.");
      return;
    }
    studentResultsState.list = dedupeAttempts(data ?? []);
    // Ensure all test versions referenced in results are in testsState.list so
    // getAttemptTestType() can classify them and buildResultAttemptEntries()
    // doesn't silently drop attempts whose test_version wasn't in the initial fetch.
    const resultVersions = Array.from(
      new Set(studentResultsState.list.map((a) => String(a?.test_version ?? "").trim()).filter(Boolean))
    );
    await ensureTestVersionsLoaded(resultVersions);
    await refreshQuestionsForResultAttempts(studentResultsState.list, { force: true });
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
