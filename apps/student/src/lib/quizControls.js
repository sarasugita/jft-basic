import { TOTAL_TIME_SEC } from "./constants";
import { getEffectiveAnswerIndices, isChoiceCorrect } from "./questionHelpers";
import { getChoiceDisplayOrder, getQuestions } from "../state/questionsState";
import { state, saveState } from "../state/appState";
import { getActiveTestSession } from "./sessionHelpers";
import { getActiveSections, getCurrentSection, getSectionQuestions } from "./sectionHelpers";
import { triggerRender } from "./renderBus";

export function startTestTimer() {
  if (state.testStartAt) return;
  state.testStartAt = Date.now();
  state.focusWarnings = 0;
  state.tabLeftCount = 0;
  state.focusWarningAt = 0;
  saveState();
}

export function getActiveTimeLimitSec() {
  const sessionLimitMin = Number(getActiveTestSession()?.time_limit_min);
  if (Number.isFinite(sessionLimitMin) && sessionLimitMin > 0) {
    return Math.max(1, Math.floor(sessionLimitMin * 60));
  }
  return TOTAL_TIME_SEC;
}

export function getTotalTimeLeftSec() {
  const base = state.testEndAt ?? Date.now();
  const totalLimitSec = getActiveTimeLimitSec();
  if (!state.testStartAt) return totalLimitSec;
  const elapsed = Math.floor((base - state.testStartAt) / 1000);
  return Math.max(0, totalLimitSec - elapsed);
}

export function countAnsweredAll() {
  return Object.keys(state.answers).length;
}

export function scoreAll() {
  let correct = 0;
  const list = getQuestions();
  for (const question of list) {
    const ans = state.answers[question.id];
    if (isChoiceCorrect(ans, getEffectiveAnswerIndices(question))) correct += 1;
  }
  return { correct, total: list.length };
}

export function toggleBangla() {
  state.showBangla = !state.showBangla;
  saveState();
  triggerRender();
}

export function setSingleAnswer(questionId, choiceIndex) {
  const question = getQuestions().find((item) => item.id === questionId);
  const displayOrder = question ? getChoiceDisplayOrder(question) : [];
  const canonicalIndex = displayOrder[choiceIndex] ?? choiceIndex;
  state.answers = { ...state.answers, [questionId]: canonicalIndex };
  saveState();
  triggerRender();
}

export function setPartAnswer(questionId, partIdx, choiceIndex) {
  const current = state.answers[questionId];
  const partAnswers = current?.partAnswers ? [...current.partAnswers] : [];
  partAnswers[partIdx] = choiceIndex;
  state.answers = { ...state.answers, [questionId]: { partAnswers } };
  saveState();
  triggerRender();
}

export function jumpToQuestionInSection(index) {
  const section = getCurrentSection();
  const questions = getSectionQuestions(section.key);
  state.questionIndexInSection = Math.max(0, Math.min(index, questions.length - 1));
  saveState();
  triggerRender();
}

export function goPrevQuestion() {
  state.questionIndexInSection = Math.max(0, state.questionIndexInSection - 1);
  saveState();
  triggerRender();
}

export function goNextSectionOrResult() {
  const activeSections = getActiveSections();
  const nextSectionIndex = state.sectionIndex + 1;
  if (nextSectionIndex >= activeSections.length) {
    state.testEndAt = state.testEndAt ?? Date.now();
    state.phase = "result";
    saveState();
    triggerRender();
    return;
  }

  state.sectionIndex = nextSectionIndex;
  state.questionIndexInSection = 0;
  state.phase = "sectionIntro";
  saveState();
  triggerRender();
}

export function goNextQuestionOrEnd() {
  const section = getCurrentSection();
  const questions = getSectionQuestions(section.key);
  const next = state.questionIndexInSection + 1;
  if (next >= questions.length) {
    goNextSectionOrResult();
    return;
  }
  state.questionIndexInSection = next;
  saveState();
  triggerRender();
}

export function finishSection() {
  goNextSectionOrResult();
}

