import { sections } from "../../../../packages/shared/questions.js";
import { formatSubSectionLabel } from "./formatters";
import { state, saveState } from "../state/appState";
import { getQuestions } from "../state/questionsState";

export function getSectionTitle(sectionKey) {
  return sections.find((section) => section.key === sectionKey)?.title ?? sectionKey ?? "";
}

export function getQuestionSectionLabel(question) {
  return formatSubSectionLabel(question?.sectionLabel) || getSectionTitle(question?.sectionKey);
}

export function getQuestionPrompt(question) {
  return question?.boxText || question?.stemText || question?.stemExtra || question?.promptEn || "";
}

export function getActiveSections() {
  const all = sections ?? [];
  const list = getQuestions();
  if (!list || list.length === 0) return all;
  const keys = new Set(list.map((question) => question.sectionKey).filter(Boolean));
  return all.filter((section) => keys.has(section.key));
}

export function getSectionQuestions(sectionKey) {
  const list = getQuestions()
    .filter((question) => question.sectionKey === sectionKey)
    .sort((left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0));
  const groups = [];
  const map = new Map();
  for (const question of list) {
    const sourceVersion = String(question.sourceVersion ?? "").trim();
    const sourceQuestionId = String(question.sourceQuestionId ?? "").trim();
    const localQuestionKey = String(question.qid ?? question.id ?? "").trim();
    const key = sourceVersion
      ? `${sourceVersion}::${sourceQuestionId || localQuestionKey || question.id}`
      : localQuestionKey || String(question.id ?? "");
    let group = map.get(key);
    if (!group) {
      group = { key, items: [], orderIndex: question.orderIndex ?? 0 };
      map.set(key, group);
      groups.push(group);
    }
    group.items.push(question);
    if (question.orderIndex != null && question.orderIndex < group.orderIndex) {
      group.orderIndex = question.orderIndex;
    }
  }
  for (const group of groups) {
    group.items.sort((left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0));
  }
  return groups.sort((left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0));
}

export function getCurrentSection() {
  const active = getActiveSections();
  if (active.length === 0) return sections[state.sectionIndex] || sections[0];
  if (state.sectionIndex >= active.length) {
    state.sectionIndex = 0;
    state.questionIndexInSection = 0;
    saveState();
  }
  return active[state.sectionIndex];
}

export function getCurrentQuestion() {
  const section = getCurrentSection();
  const questions = getSectionQuestions(section.key);
  return questions[state.questionIndexInSection];
}

export function getQuestionProgress() {
  const activeSections = getActiveSections();
  let total = 0;
  let current = 0;
  activeSections.forEach((section, sectionIndex) => {
    const groups = getSectionQuestions(section.key);
    const sectionCount = groups.length;
    if (sectionIndex < state.sectionIndex) {
      current += sectionCount;
    } else if (sectionIndex === state.sectionIndex) {
      current += Math.min(state.questionIndexInSection, Math.max(sectionCount - 1, 0)) + 1;
    }
    total += sectionCount;
  });
  if (total === 0) {
    return { current: 0, total: 0 };
  }
  return { current: Math.min(current, total), total };
}
