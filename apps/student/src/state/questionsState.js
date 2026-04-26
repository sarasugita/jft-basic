import { supabase, publicSupabase } from "../supabaseClient";
import { questions } from "../../../../packages/shared/questions.js";
import { QUESTION_SELECT_BASE, TEST_VERSION, SUPABASE_URL } from "../lib/constants";
import {
  normalizeStemKindValue, splitAssetList, isImageChoiceValue,
  hashString, shuffleWithSeed,
} from "../lib/questionHelpers";
import { getErrorMessage, logSupabaseError, logUnexpectedError } from "../lib/errorHelpers";
import { triggerRender } from "../lib/renderBus";
import { state } from "./appState";
import { authState } from "./authState";
import { testsState, getActiveTestVersion, getActiveTestSession, getSessionTestType } from "./testsState";

export let questionsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
  version: "",
  updatedAt: "",
};

// Build legacy question map from static shared package (used for fallback image lookup)
export const legacyQuestionMap = (() => {
  const map = new Map();
  for (const q of questions ?? []) {
    if (q?.id) map.set(q.id, q);
  }
  return map;
})();

// --- Asset URL helpers (will move to lib/questionHelpers.js in Phase 3) ---

export function getAssetBaseUrl(testVersion, assetType) {
  if (!SUPABASE_URL || !testVersion) return "";
  const test = testsState.list.find((t) => t.version === testVersion);
  const type = test?.type || "mock";
  return `${SUPABASE_URL}/storage/v1/object/public/test-assets/${type}/${testVersion}/${assetType}/`;
}

function buildPublicAssetUrl(objectPath) {
  const raw = String(objectPath ?? "").trim();
  if (!raw || !SUPABASE_URL) return raw;
  const encodedPath = raw
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/test-assets/${encodedPath}`;
}

function isStorageObjectAssetPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) return false;
  return raw.includes("/") && /\.(png|jpe?g|webp|gif|svg|mp3|wav|m4a|ogg)(\?.*)?$/i.test(raw);
}

export function resolveAssetUrl(value, testVersion) {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (isStorageObjectAssetPath(raw)) return buildPublicAssetUrl(raw);
  if (raw.includes("/")) return raw;
  const isAudio = /\.(mp3|wav|m4a|ogg)$/i.test(raw);
  const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(raw);
  if (!isAudio && !isImage) return raw;
  const assetType = isAudio ? "audio" : "image";
  const base = getAssetBaseUrl(testVersion, assetType);
  return base ? `${base}${raw}` : raw;
}

export function normalizeQuestionAssets(q, version) {
  const next = { ...q };
  next.stemKind = normalizeStemKindValue(next.stemKind || "");
  const mergedStemAssets = [
    next.stemAsset,
    next.stemAudio,
    next.stemImage,
  ]
    .flatMap((value) => splitAssetList(value))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .map((value) => resolveAssetUrl(value, version));
  next.stemAsset = mergedStemAssets.join("|") || null;
  if (next.stemAudio) next.stemAudio = resolveAssetUrl(next.stemAudio, version);
  if (next.stemImage) next.stemImage = resolveAssetUrl(next.stemImage, version);
  if (next.stemKind === "dialog") {
    const parts = splitAssetList(next.stemAsset);
    const hasImage = parts.some((p) => isImageChoiceValue(p));
    if (!hasImage) {
      const legacy = legacyQuestionMap.get(next.id);
      const legacyImage = legacy?.image || legacy?.stemImage || null;
      if (legacyImage) {
        parts.push(legacyImage);
        next.stemAsset = parts.filter(Boolean).join("|");
      }
    }
  }
  if (next.stemKind === "audio" || next.stemKind === "audio_image" || next.stemKind === "image_audio") {
    const parts = splitAssetList(next.stemAsset);
    const hasImage = parts.some((p) => isImageChoiceValue(p));
    if (!hasImage) {
      const legacy = legacyQuestionMap.get(next.id);
      const legacyImage = legacy?.stemImage || legacy?.image || legacy?.passageImage || null;
      if (legacyImage) {
        parts.push(legacyImage);
        next.stemAsset = parts.filter(Boolean).join("|");
      }
    }
  }
  if (Array.isArray(next.choices)) {
    next.choices = next.choices.map((v) => resolveAssetUrl(v, version));
  }
  return next;
}

export function mapDbQuestion(row, version) {
  const data = row.data ?? {};
  const sourceVersion = String(data.sourceVersion ?? data.source_version ?? "").trim() || null;
  const sourceQuestionId = String(data.sourceQuestionId ?? data.source_question_id ?? "").trim() || null;
  const stemAsset = [
    data.stemAsset,
    data.stem_asset,
    data.stemAudio,
    data.stem_audio,
    data.stemImage,
    data.stem_image,
  ]
    .flatMap((value) => splitAssetList(value))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join("|") || null;
  const base = {
    id: data.itemId || row.question_id,
    qid: data.qid || null,
    subId: data.subId || null,
    sectionKey: row.section_key,
    sectionLabel: data.sectionLabel || data.section_label || null,
    type: row.type,
    promptEn: row.prompt_en,
    promptBn: row.prompt_bn,
    answerIndex: row.answer_index,
    answerIndices: Array.isArray(data.answer_indices) ? data.answer_indices : null,
    orderIndex: row.order_index ?? 0,
    sourceVersion,
    sourceQuestionId,
    stemKind: normalizeStemKindValue(data.stemKind || data.stem_kind || row.media_type || null),
    stemText: data.stemText || null,
    stemAsset,
    stemImage: data.stemImage || data.stem_image || null,
    stemAudio: data.stemAudio || data.stem_audio || null,
    stemExtra: data.stemExtra || null,
    boxText: data.boxText || null,
    choices: data.choices || data.choicesJa || [],
    blankStyle: data.blankStyle || null,
    target: data.target || null,
  };
  return normalizeQuestionAssets(base, version);
}

function orderQuestionsForSession(list, version) {
  const session = getActiveTestSession();
  if (!session?.id || getSessionTestType(session) !== "mock") return list;

  const sectionOrder = [];
  const grouped = new Map();
  list.forEach((question) => {
    const sectionKey = String(question.sectionKey ?? "");
    if (!grouped.has(sectionKey)) {
      grouped.set(sectionKey, []);
      sectionOrder.push(sectionKey);
    }
    grouped.get(sectionKey).push(question);
  });

  return sectionOrder.flatMap((sectionKey) => {
    const sectionQuestions = [...(grouped.get(sectionKey) ?? [])];
    return sectionQuestions.sort((left, right) => {
      const leftRank = hashString(`${session.id}:${version}:${sectionKey}:${left.id}:${left.orderIndex ?? 0}`);
      const rightRank = hashString(`${session.id}:${version}:${sectionKey}:${right.id}:${right.orderIndex ?? 0}`);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (left.orderIndex ?? 0) - (right.orderIndex ?? 0);
    });
  });
}

export async function fetchQuestionRowsWithFallback(version) {
  const client = authState.session ? supabase : publicSupabase;
  return client
    .from("questions")
    .select(QUESTION_SELECT_BASE)
    .eq("test_version", version)
    .order("order_index", { ascending: true });
}

export async function fetchQuestionsForVersion(version, updatedAt = "") {
  if (!version) return;
  if (questionsState.loading && questionsState.version === version) return;
  const hadCachedVersion = questionsState.loaded && questionsState.version === version && questionsState.list.length > 0;
  const previousList = hadCachedVersion ? questionsState.list : [];
  const previousUpdatedAt = hadCachedVersion ? questionsState.updatedAt : "";
  questionsState.loading = true;
  questionsState.error = "";
  questionsState.version = version;
  try {
    const { data, error } = await fetchQuestionRowsWithFallback(version);
    if (error) {
      logSupabaseError("questions fetch error", error);
      questionsState.list = previousList;
      questionsState.error = getErrorMessage(error, "Failed to load questions.");
      questionsState.loaded = hadCachedVersion;
      questionsState.updatedAt = previousUpdatedAt;
      return;
    }
    const mappedQuestions = (data ?? []).map((row) => mapDbQuestion(row, version));
    questionsState.list = orderQuestionsForSession(mappedQuestions, version);
    if (version !== TEST_VERSION && questionsState.list.length === 0) {
      questionsState.error = `No uploaded questions found for ${version}.`;
    }
    questionsState.loaded = true;
    questionsState.updatedAt = updatedAt || "";
  } catch (error) {
    logUnexpectedError("questions fetch failed", error);
    questionsState.list = previousList;
    questionsState.error = getErrorMessage(error, "Failed to load questions.");
    questionsState.loaded = hadCachedVersion;
    questionsState.updatedAt = previousUpdatedAt;
  } finally {
    questionsState.loading = false;
  }
}

export async function ensureSessionQuestionsAvailable(session) {
  const version = String(session?.problem_set_id ?? "").trim();
  if (!version) {
    questionsState.error = "This test session is missing a problem set.";
    triggerRender();
    window.alert(questionsState.error);
    return false;
  }

  const problemSet = testsState.list.find((test) => test.version === version);
  const updatedAt = problemSet?.updated_at ?? "";
  const needsRefresh =
    !questionsState.loaded
    || questionsState.version !== version
    || questionsState.updatedAt !== updatedAt;

  if (needsRefresh) {
    await fetchQuestionsForVersion(version, updatedAt);
  }

  if (!questionsState.list.length) {
    triggerRender();
    window.alert(questionsState.error || `No uploaded questions found for ${version}.`);
    return false;
  }

  return true;
}

export function ensureQuestionsLoaded() {
  const version = getActiveTestVersion();
  if (!version) return;
  const problemSet = testsState.list.find((t) => t.version === version);
  const updatedAt = problemSet?.updated_at ?? "";
  if ((questionsState.version !== version || questionsState.updatedAt !== updatedAt) && !questionsState.loading) {
    fetchQuestionsForVersion(version, updatedAt).finally(triggerRender);
  }
}

export function getQuestions() {
  if (questionsState.loaded && questionsState.version === getActiveTestVersion()) {
    return questionsState.list;
  }
  return [];
}

// --- Choice display order helper (will move to lib/questionHelpers.js in Phase 3) ---

export function getChoiceDisplayOrder(question) {
  const choices = Array.isArray(question?.choices) ? question.choices : [];
  if (choices.length <= 1) {
    return choices.map((_, index) => index);
  }
  const studentId = String(
    authState.profile?.student_code
    || state.user?.id
    || authState.session?.user?.id
    || state.user?.name
    || ""
  ).trim();
  const sessionId = String(
    state.linkTestSessionId
    || state.selectedTestSessionId
    || getActiveTestVersion()
    || ""
  ).trim();
  const seed = [
    studentId || "student",
    sessionId || "session",
    String(question?.sectionKey ?? "").trim(),
    String(question?.id ?? "").trim(),
  ].join(":");
  return shuffleWithSeed(
    choices.map((_, index) => index),
    `${seed}:choices`,
  );
}

export function getDisplayedChoices(question) {
  const choices = Array.isArray(question?.choices) ? question.choices : [];
  const order = getChoiceDisplayOrder(question);
  return order.map((choiceIndex, displayIndex) => ({
    displayIndex,
    canonicalIndex: choiceIndex,
    value: choices[choiceIndex],
  }));
}
