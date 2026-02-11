import fs from "node:fs/promises";
import path from "node:path";

const questionsPath = new URL("../packages/shared/questions.js", import.meta.url);
const questionsModule = await import(questionsPath);
const questions = questionsModule.questions ?? [];

const outDir = path.resolve("docs/sample_test_assets");
await fs.mkdir(outDir, { recursive: true });

const fileSet = new Set();
const collect = (val) => {
  if (!val) return;
  const name = path.posix.basename(String(val));
  if (name) fileSet.add(name);
};

for (const q of questions) {
  collect(q.image);
  collect(q.audio);
  collect(q.stemImage);
  collect(q.passageImage);
  collect(q.tableImage);
  if (Array.isArray(q.choiceImages)) q.choiceImages.forEach(collect);
  if (Array.isArray(q.parts)) {
    for (const p of q.parts) {
      if (Array.isArray(p.choiceImages)) p.choiceImages.forEach(collect);
    }
  }
}

const pngData = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64"
);

const mp3Data = Buffer.from("placeholder", "utf8");

for (const name of fileSet) {
  const ext = name.toLowerCase().split(".").pop();
  const filePath = path.join(outDir, name);
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") {
    await fs.writeFile(filePath, pngData);
  } else if (ext === "mp3" || ext === "wav" || ext === "m4a" || ext === "ogg") {
    await fs.writeFile(filePath, mp3Data);
  } else {
    await fs.writeFile(filePath, "");
  }
}

const readme = `Sample assets for CSV import.
These files are placeholders to match filenames referenced in Questions.js.
Replace them with real PNG/MP3 files before production use.
`;
await fs.writeFile(path.join(outDir, "README.md"), readme, "utf8");

console.log(`Wrote ${fileSet.size} assets to ${outDir}`);
