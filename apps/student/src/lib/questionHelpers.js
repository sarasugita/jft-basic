export function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function shuffleWithSeed(items, seedValue) {
  const next = [...items];
  let seed = hashString(seedValue);
  for (let index = next.length - 1; index > 0; index -= 1) {
    seed = Math.imul(seed ^ 0x9e3779b9, 16777619) >>> 0;
    const swapIndex = seed % (index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export function normalizeStemKindValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s/+]+/g, "_");
}

export function splitStemLines(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitStemLinesPreserveIndent(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.replace(/\s+$/g, ""))
    .filter((s) => s.trim().length);
}

export function splitTextBoxStemLines(text) {
  const baseLines = splitStemLinesPreserveIndent(text);
  const expanded = [];
  for (const line of baseLines) {
    const speakerMatches = Array.from(
      String(line).matchAll(/(?:^|\s+)([^:：\s]{1,20}[：:].*?)(?=(?:\s+[^:：\s]{1,20}[：:])|$)/g)
    )
      .map((match) => String(match[1] ?? "").trim())
      .filter(Boolean);
    if (speakerMatches.length >= 2) {
      expanded.push(...speakerMatches);
      continue;
    }
    expanded.push(line);
  }
  return expanded;
}

export function parseSpeakerStemLine(line) {
  const match = String(line ?? "").match(/^\s*([^:：]+?)([:：])(.*)$/);
  if (!match) return null;
  return {
    speaker: String(match[1] ?? "").trim(),
    delimiter: match[2] ?? "：",
    body: String(match[3] ?? "").replace(/^\s+/g, ""),
  };
}

export function getAssetProbeTarget(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

export function isImageChoiceValue(value) {
  const probe = getAssetProbeTarget(value);
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(probe)
    || probe.includes("/images/")
    || probe.includes("/image/");
}

export function isAudioAssetValue(value) {
  const probe = getAssetProbeTarget(value);
  return /\.(mp3|wav|m4a|ogg)(\?.*)?$/i.test(probe)
    || probe.includes("/audio/")
    || probe.includes("/audios/");
}

export function splitAssetList(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  if (raw.includes("|") || raw.includes("\n")) {
    return splitStemLines(raw);
  }
  return [raw];
}

export function getStemMediaAssets(question) {
  const assets = [
    question?.stemAsset,
    question?.stemAudio,
    question?.stemImage,
    question?.image,
    question?.passageImage,
    question?.tableImage,
    question?.stem_image,
    question?.stem_image_url,
  ]
    .flatMap((value) => splitAssetList(value))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  return {
    images: assets.filter((value) => isImageChoiceValue(value)),
    audios: assets.filter((value) => isAudioAssetValue(value)),
  };
}

export function getEffectiveAnswerIndices(question) {
  const fromArray = Array.isArray(question?.answerIndices)
    ? question.answerIndices
    : Array.isArray(question?.answer_indices)
      ? question.answer_indices
      : Array.isArray(question?.data?.answer_indices)
        ? question.data.answer_indices
        : [];
  const normalized = fromArray
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (normalized.length) return Array.from(new Set(normalized));
  const single = Number(question?.answerIndex);
  return Number.isFinite(single) ? [single] : [];
}

export function isChoiceCorrect(choiceIndex, answerIndices) {
  const chosen = Number(choiceIndex);
  if (!Number.isFinite(chosen)) return false;
  return (answerIndices ?? []).includes(chosen);
}
