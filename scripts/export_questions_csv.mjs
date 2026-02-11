import fs from "node:fs/promises";
import path from "node:path";
import { questions } from "../packages/shared/questions.js";

const testVersion = process.argv[2] || "test_exam";
const outPath = process.argv[3] || path.resolve("docs/test_exam_questions.csv");

const headers = [
  "test_version",
  "question_id",
  "section_key",
  "type",
  "order_index",
  "prompt_en",
  "prompt_bn",
  "answer_index",
  "sentence_ja",
  "sentence_parts_json",
  "dialog_ja",
  "blank_style",
  "image",
  "audio",
  "stem_image",
  "passage_image",
  "table_image",
  "choice1_ja",
  "choice2_ja",
  "choice3_ja",
  "choice4_ja",
  "choice5_ja",
  "choice6_ja",
  "choice1_image",
  "choice2_image",
  "choice3_image",
  "choice4_image",
  "choice5_image",
  "choice6_image",
  "part1_label",
  "part1_question_ja",
  "part1_answer_index",
  "part1_choice1_ja",
  "part1_choice2_ja",
  "part1_choice3_ja",
  "part1_choice4_ja",
  "part1_choice5_ja",
  "part1_choice6_ja",
  "part1_choice1_image",
  "part1_choice2_image",
  "part1_choice3_image",
  "part1_choice4_image",
  "part1_choice5_image",
  "part1_choice6_image",
  "part2_label",
  "part2_question_ja",
  "part2_answer_index",
  "part2_choice1_ja",
  "part2_choice2_ja",
  "part2_choice3_ja",
  "part2_choice4_ja",
  "part2_choice5_ja",
  "part2_choice6_ja",
  "part2_choice1_image",
  "part2_choice2_image",
  "part2_choice3_image",
  "part2_choice4_image",
  "part2_choice5_image",
  "part2_choice6_image",
];

const escapeCell = (value) => {
  const s = String(value ?? "");
  if (/[,"\n]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
};

const jsonList = (arr) => (Array.isArray(arr) && arr.length ? JSON.stringify(arr) : "");
const joinList = (arr) => (Array.isArray(arr) && arr.length ? arr.join("|") : "");
const basenameValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return path.posix.basename(raw);
};
const fillChoices = (target, prefix, items, images) => {
  const list = Array.isArray(items) ? items : [];
  const imgList = Array.isArray(images) ? images : [];
  for (let i = 0; i < 6; i += 1) {
    if (list[i] != null) target[`${prefix}choice${i + 1}_ja`] = list[i];
    if (imgList[i] != null) target[`${prefix}choice${i + 1}_image`] = imgList[i];
  }
};

const rows = [headers];

questions.forEach((q, idx) => {
  const parts = Array.isArray(q.parts) ? q.parts : [];
  const row = {
    test_version: testVersion,
    question_id: q.id ?? "",
    section_key: q.sectionKey ?? "",
    type: q.type ?? "",
    order_index: idx + 1,
    prompt_en: q.promptEn ?? "",
    prompt_bn: q.promptBn ?? "",
    answer_index: q.answerIndex ?? "",
    sentence_ja: q.sentenceJa ?? "",
    sentence_parts_json: jsonList(q.sentencePartsJa),
    dialog_ja: joinList(q.dialogJa),
    blank_style: q.blankStyle ?? "",
    image: basenameValue(q.image),
    audio: basenameValue(q.audio),
    stem_image: basenameValue(q.stemImage),
    passage_image: basenameValue(q.passageImage),
    table_image: basenameValue(q.tableImage),
    choice1_ja: "",
    choice2_ja: "",
    choice3_ja: "",
    choice4_ja: "",
    choice5_ja: "",
    choice6_ja: "",
    choice1_image: "",
    choice2_image: "",
    choice3_image: "",
    choice4_image: "",
    choice5_image: "",
    choice6_image: "",
    part1_label: parts[0]?.partLabel ?? "",
    part1_question_ja: parts[0]?.questionJa ?? "",
    part1_answer_index: parts[0]?.answerIndex ?? "",
    part1_choice1_ja: "",
    part1_choice2_ja: "",
    part1_choice3_ja: "",
    part1_choice4_ja: "",
    part1_choice5_ja: "",
    part1_choice6_ja: "",
    part1_choice1_image: "",
    part1_choice2_image: "",
    part1_choice3_image: "",
    part1_choice4_image: "",
    part1_choice5_image: "",
    part1_choice6_image: "",
    part2_label: parts[1]?.partLabel ?? "",
    part2_question_ja: parts[1]?.questionJa ?? "",
    part2_answer_index: parts[1]?.answerIndex ?? "",
    part2_choice1_ja: "",
    part2_choice2_ja: "",
    part2_choice3_ja: "",
    part2_choice4_ja: "",
    part2_choice5_ja: "",
    part2_choice6_ja: "",
    part2_choice1_image: "",
    part2_choice2_image: "",
    part2_choice3_image: "",
    part2_choice4_image: "",
    part2_choice5_image: "",
    part2_choice6_image: "",
  };
  fillChoices(row, "", q.choicesJa, (q.choiceImages ?? []).map(basenameValue));
  fillChoices(row, "part1_", parts[0]?.choicesJa, (parts[0]?.choiceImages ?? []).map(basenameValue));
  fillChoices(row, "part2_", parts[1]?.choicesJa, (parts[1]?.choiceImages ?? []).map(basenameValue));
  rows.push(headers.map((h) => escapeCell(row[h] ?? "")));
});

const csv = rows.map((r) => r.join(",")).join("\n");
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, csv, "utf8");
console.log(`Wrote ${outPath}`);
