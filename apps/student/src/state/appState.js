import { STORAGE_KEY } from "../lib/constants";
import { triggerRender } from "../lib/renderBus";

let refreshLinkStateFn = null;

export const defaultState = {
  phase: "intro",
  sectionIndex: 0,
  questionIndexInSection: 0,
  answers: {},
  showBangla: false,
  testStartAt: null,
  testEndAt: null,
  user: { name: "", id: "" },
  attemptSaved: false,
  linkId: null,
  linkExpiresAt: null,
  linkTestVersion: null,
  linkTestSessionId: null,
  linkChecked: false,
  linkInvalid: false,
  linkLoginRequired: false,
  requireLogin: true,
  selectedTestVersion: "",
  selectedTestSessionId: "",
  studentPanelUserId: "",
  studentTab: "home",
  dailyResultsCategory: "",
  dailyResultsFailedOnly: false,
  dailyResultsPage: 1,
  modelResultsPage: 1,
  rankingSelectedPeriod: "",
  attendanceMonthKey: "",
  focusWarnings: 0,
  tabLeftCount: 0,
  focusWarningAt: 0,
};

export let appBootstrapState = {
  loading: true,
};

export let state = loadState();

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultState };
    const loaded = { ...defaultState, ...JSON.parse(raw) };
    if (!["quiz", "sectionIntro", "result"].includes(loaded.phase)) {
      loaded.phase = "intro";
    }
    loaded.tabLeftCount = Math.max(
      0,
      Number(loaded.tabLeftCount ?? loaded.focusWarnings ?? 0)
    );
    if (loaded.studentTab === "results") loaded.studentTab = "dailyResults";
    if (loaded.studentTab === "take") loaded.studentTab = "home";
    if (!["home", "personalInformation", "dailyResults", "modelResults", "ranking", "attendance", "attendanceHistory"].includes(loaded.studentTab)) {
      loaded.studentTab = "home";
    }
    return loaded;
  } catch {
    return { ...defaultState };
  }
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setLinkStateRefreshCallback(fn) {
  refreshLinkStateFn = typeof fn === "function" ? fn : null;
}

export function shouldBlockOnQuestions() {
  return ["sectionIntro", "quiz", "result"].includes(state.phase);
}

export function resetAll() {
  Object.assign(state, defaultState);
  state.testEndAt = null;
  state.requireLogin = true;
  state.focusWarnings = 0;
  state.tabLeftCount = 0;
  state.focusWarningAt = 0;

  let linkId = "";
  try {
    const url = new URL(window.location.href);
    linkId = url.searchParams.get("link") || "";
  } catch {
    linkId = "";
  }

  if (!linkId) {
    state.linkChecked = true;
    saveState();
    triggerRender();
    return;
  }

  saveState();
  Promise.resolve(refreshLinkStateFn?.())
    .finally(() => {
      triggerRender();
    });
}

export function exitToHome() {
  if (state.linkId) {
    state.linkId = null;
    state.linkExpiresAt = null;
    state.linkTestVersion = null;
    state.linkTestSessionId = null;
    state.linkInvalid = false;
    state.linkLoginRequired = false;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("link");
      window.history.replaceState({}, "", url.toString());
    } catch {
      // ignore URL update failures
    }
  }
  state.phase = "intro";
  state.sectionIndex = 0;
  state.questionIndexInSection = 0;
  state.showBangla = false;
  state.testStartAt = null;
  state.testEndAt = null;
  state.answers = {};
  state.attemptSaved = false;
  state.requireLogin = false;
  state.linkLoginRequired = false;
  state.focusWarnings = 0;
  state.tabLeftCount = 0;
  state.focusWarningAt = 0;
  saveState();
  triggerRender();
}

export function goIntro() {
  state.phase = "intro";
  state.sectionIndex = 0;
  state.questionIndexInSection = 0;
  state.showBangla = false;
  state.testStartAt = null;
  state.testEndAt = null;
  state.attemptSaved = false;
  state.focusWarnings = 0;
  state.tabLeftCount = 0;
  state.focusWarningAt = 0;
  saveState();
  triggerRender();
}
