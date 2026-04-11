import { escapeHtml } from "./escapeHtml";
import { formatSubSectionLabel } from "./formatters";
import {
  normalizeStemKindValue,
  splitStemLines,
  splitStemLinesPreserveIndent,
  splitTextBoxStemLines,
  parseSpeakerStemLine,
  getStemMediaAssets,
  isImageChoiceValue,
  isAudioAssetValue,
} from "./questionHelpers";
import { state } from "../state/appState";
import { getActiveTestType } from "../state/testsState";
import { getChoiceDisplayOrder, getDisplayedChoices } from "../state/questionsState";
import { getCurrentSection, getSectionQuestions } from "./sectionHelpers";

export function renderStemMarkup(text) {
  const escaped = escapeHtml(text ?? "");
  return escaped
    .replace(/【(.*?)】/g, (_, inner) => (String(inner ?? "").replace(/[\s\u3000]/g, "").length
      ? `<span class="u">${inner}</span>`
      : '<span class="blank-red"></span>'))
    .replace(/［[\s\u3000]*］|\[[\s\u3000]*\]/g, '<span class="blank-red"></span>');
}

export function renderUnderlines(text) {
  return renderStemMarkup(text);
}

export function renderSpeakerStemLines(lines, containerClass = "dialog-lines") {
  if (!Array.isArray(lines) || !lines.length) return "";
  return `<div class="${containerClass}">${lines
    .map((line) => {
      const parsed = parseSpeakerStemLine(line);
      if (!parsed || !parsed.speaker) {
        return `<div class="dialog-line dialog-line-plain">${renderStemMarkup(line)}</div>`;
      }
      return `
        <div class="dialog-line">
          <span class="dialog-speaker">${escapeHtml(parsed.speaker)}${escapeHtml(parsed.delimiter)}</span>
          <span class="dialog-body">${renderStemMarkup(parsed.body)}</span>
        </div>
      `;
    })
    .join("")}</div>`;
}

export function getChoices(question) {
  const raw = Array.isArray(question?.choices)
    ? question.choices
    : Array.isArray(question?.choicesJa)
      ? question.choicesJa
      : [];
  return raw
    .map((value) => (value == null ? "" : String(value).trim()))
    .filter((value) => value && value.toUpperCase() !== "N/A");
}

export function isJapaneseText(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(String(value ?? ""));
}

export function renderChoicesText(question, choices) {
  const chosen = state.answers[question.id];
  const displayChoices = getDisplayedChoices({ ...question, choices });
  return `
    <div class="choices">
      ${displayChoices.map(({ displayIndex, canonicalIndex, value }) => {
        const sel = chosen === canonicalIndex ? "selected" : "";
        const jp = isJapaneseText(value) ? "jp" : "";
        return `<button class="choice ${sel} ${jp}" data-choice="${displayIndex}" data-qid="${question.id}">${escapeHtml(value)}</button>`;
      }).join("")}
    </div>
  `;
}

export function renderChoicesImages(question, choices) {
  const chosen = state.answers[question.id];
  const displayChoices = getDisplayedChoices({ ...question, choices });
  return `
    <div class="img-choice-grid">
      ${displayChoices.map(({ displayIndex, canonicalIndex, value }) => {
        const sel = chosen === canonicalIndex ? "selected" : "";
        return `
          <button class="img-choice ${sel}" data-choice="${displayIndex}" data-qid="${question.id}">
            <img src="${value}" alt="choice ${displayIndex + 1}" />
          </button>
        `;
      }).join("")}
    </div>
  `;
}

export function renderStemHTML(question, opts = {}) {
  if (opts.skipStem) return "";
  const isDaily = getActiveTestType() === "daily";
  const parts = [];
  const stemKind = normalizeStemKindValue(question.stemKind || "");
  const stemMedia = getStemMediaAssets(question);
  const audioAssets = stemMedia.audios;
  const imageAssets = stemMedia.images;
  if (stemKind === "dialog" || stemKind === "text_box") {
    const lines = stemKind === "text_box"
      ? splitTextBoxStemLines(question.stemExtra || question.stemText || "")
      : splitStemLinesPreserveIndent(question.stemExtra || question.stemText || "");
    const dialogLines = renderSpeakerStemLines(lines, stemKind === "text_box" ? "dialog-lines text-box-lines" : "dialog-lines");
    if (imageAssets.length) {
      parts.push(`
        <div class="dialog-row">
          ${dialogLines}
          <div class="dialog-img">
            ${imageAssets.map((src) => `<img src="${src}" alt="dialog" />`).join("")}
          </div>
        </div>
      `);
    } else if (dialogLines) {
      parts.push(dialogLines);
    }
  } else {
    if (!opts.skipStemText && question.stemText) {
      parts.push(`<div class="stem-text preserve-lines">${renderUnderlines(question.stemText)}</div>`);
    }
    if (!opts.skipStemExtra && question.stemExtra) {
      const lines = splitStemLines(question.stemExtra);
      if (lines.length) {
        parts.push(`<div class="stem-extra">${lines.map((line) => `<div>${renderUnderlines(line)}</div>`).join("")}</div>`);
      }
    }
  }
  if ((stemKind === "audio" || stemKind === "audio_image" || stemKind === "image_audio") || audioAssets.length) {
    const imgClass = isDaily
      ? "illustration illustration-daily"
      : question.sectionKey === "CE"
        ? "illustration illustration-wide"
        : question.sectionKey === "SV"
          ? "illustration illustration-small"
          : "illustration";
    const imgWrapClass = question.sectionKey === "LC" ? "question-area left" : "question-area";
    if (audioAssets.length) {
      parts.push(`
        <div class="stem-audio-wrap">
          ${audioAssets.map((src) => `<audio class="stem-audio-player" controls preload="auto" src="${src}"></audio>`).join("")}
        </div>
      `);
    }
    if (imageAssets.length) {
      parts.push(`
        <div class="${imgWrapClass}">
          ${imageAssets.map((src) => `<img class="${imgClass}" src="${src}" alt="stem" />`).join("")}
        </div>
      `);
    }
  }
  if ((["image", "passage_image", "table_image"].includes(stemKind) || (!stemKind && imageAssets.length && !audioAssets.length)) && imageAssets.length) {
    const cls = isDaily
      ? "illustration illustration-daily"
      : stemKind === "image"
        ? question.sectionKey === "CE"
          ? "illustration illustration-wide"
          : question.sectionKey === "SV"
            ? "illustration illustration-small"
            : "illustration"
        : "passage-img";
    parts.push(`
      <div class="question-area">
        ${imageAssets.map((src) => `<img class="${cls}" src="${src}" alt="stem" />`).join("")}
      </div>
    `);
  }
  if (!question.stemKind && audioAssets.length === 1 && imageAssets.length === 0) {
    parts.push(`
      <div class="stem-audio-wrap">
        <audio class="stem-audio-player" controls preload="auto" src="${audioAssets[0]}"></audio>
      </div>
    `);
  }
  if (!question.stemKind && imageAssets.length === 1 && audioAssets.length === 0) {
    parts.push(`
      <div class="question-area">
        <img class="${isDaily ? "illustration illustration-daily" : "illustration"}" src="${imageAssets[0]}" alt="stem" />
      </div>
    `);
  }
  if (!opts.skipBoxText && question.boxText) {
    parts.push(`<div class="boxed">${renderUnderlines(question.boxText)}</div>`);
  }
  return parts.join("");
}

export function promptBoxHTML(question, opts = {}) {
  const showPrompt = opts.showPrompt !== false;
  const includeStemInPrompt = Boolean(opts.includeStemInPrompt);
  const includeBoxTextInPrompt = Boolean(opts.includeBoxTextInPrompt);
  const main = question.promptEn ?? "";
  const sub = question.promptBn ?? "";
  const lines = [];
  if (showPrompt && main) lines.push(`<div class="prompt preserve-lines">${escapeHtml(main)}</div>`);
  if (showPrompt && state.showBangla && sub) lines.push(`<div class="prompt-sub preserve-lines">${escapeHtml(sub)}</div>`);
  if (includeStemInPrompt) {
    const stemLines = splitStemLines(question.stemText || question.stemExtra || "");
    if (stemLines.length) {
      lines.push(`<div class="sv-stem">${stemLines.map((line) => `<div class="jp-sentence">${renderUnderlines(line)}</div>`).join("")}</div>`);
    }
  }
  if (includeBoxTextInPrompt && question.boxText) {
    const subPrefix = question.subId && question.subId !== "N/A" ? `(${question.subId}) ` : "";
    const jpClass = question.sectionKey === "LC" || question.sectionKey === "RC" ? "jp-sentence jp-bold" : "jp-sentence";
    lines.push(`<div class="${jpClass}">${renderUnderlines(`${subPrefix}${question.boxText}`)}</div>`);
  }
  if (!lines.length) return "";
  return `<div class="blue-box">${lines.join("")}</div>`;
}

export function questionBodyHTML(question, opts = {}) {
  const choices = getChoices(question);
  const hasImageChoices = choices.length > 0 && choices.every((choice) => isImageChoiceValue(choice));
  return `
    ${renderStemHTML(question, opts)}
    ${choices.length ? (hasImageChoices ? renderChoicesImages(question, choices) : renderChoicesText(question, choices)) : ""}
  `;
}

export function renderQuestionBlock(question, opts = {}) {
  const promptBox = promptBoxHTML(question, opts);
  const body = questionBodyHTML(question, opts);
  return `<div class="question-block">${promptBox}${body}</div>`;
}

function hasSharedPrompt(items) {
  if (!items.length) return null;
  const first = items[0];
  const key = `${first.promptEn ?? ""}|||${first.promptBn ?? ""}`;
  if (!key.trim()) return null;
  for (const item of items) {
    const current = `${item.promptEn ?? ""}|||${item.promptBn ?? ""}`;
    if (current !== key) return null;
  }
  return first;
}

function getSharedStem(items) {
  if (items.length < 2) return null;
  const first = items[0];
  const keys = ["stemKind", "stemText", "stemExtra", "stemAsset"];
  for (const item of items) {
    for (const key of keys) {
      if ((item[key] ?? null) !== (first[key] ?? null)) return null;
    }
  }
  if (!first.stemKind && !first.stemText && !first.stemExtra && !first.stemAsset) return null;
  return first;
}

export function banglaButtonHTML() {
  if (getActiveTestType() === "daily") return "";
  return `
    <div class="lang-buttons">
      <button class="lang-btn" id="banglaBtn">
        ${state.showBangla ? "✓ " : ""}Bangla
      </button>
    </div>
  `;
}

export function renderQuestionGroupHTML(group) {
  const items = group?.items ?? [];
  if (!items.length) return `<div class="placeholder">No question</div>`;

  if (items.length === 1) {
    const question = items[0];
    const includeStemInPrompt = question.sectionKey === "SV";
    const includeBoxTextInPrompt = !question.promptEn && Boolean(question.boxText);
    const promptBox = promptBoxHTML(question, {
      showPrompt: true,
      includeStemInPrompt,
      includeBoxTextInPrompt,
    });
    const body = questionBodyHTML(question, {
      skipStemText: includeStemInPrompt,
      skipBoxText: includeBoxTextInPrompt,
    });
    return `
      ${promptBox}
      ${banglaButtonHTML()}
      <div class="question-block">${body}</div>
    `;
  }

  const sharedPrompt = hasSharedPrompt(items);
  const sharedStem = getSharedStem(items);
  const blocks = [];
  if (sharedPrompt) {
    const promptBox = promptBoxHTML(sharedPrompt, { showPrompt: true });
    if (promptBox) blocks.push(promptBox);
  }
  blocks.push(banglaButtonHTML());
  if (sharedStem) {
    blocks.push(renderStemHTML({ ...sharedStem, boxText: null }, { skipBoxText: true }));
  }
  items.forEach((question) => {
    const includeStemInPrompt = question.sectionKey === "SV";
    const includeBoxTextInPrompt = Boolean(question.boxText);
    const showPrompt = !sharedPrompt;
    blocks.push(
      renderQuestionBlock(question, {
        showPrompt,
        includeStemInPrompt,
        includeBoxTextInPrompt,
        skipStemText: includeStemInPrompt,
        skipBoxText: includeBoxTextInPrompt,
        skipStem: Boolean(sharedStem),
      })
    );
  });
  return blocks.join("");
}

export function sidebarHTML() {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  return `
    <aside class="sidebar">
      <div class="side-title">intro</div>
      <div class="step-list">
        ${secQs
          .map((_, idx) => {
            const active = idx === state.questionIndexInSection ? "active" : "";
            return `
              <button class="step ${active}" data-step="${idx}">
                <span class="step-num">${idx + 1}</span>
                <span class="step-arrow"></span>
              </button>
            `;
          })
          .join("")}
      </div>
      <div class="side-rail"></div>
    </aside>
  `;
}
