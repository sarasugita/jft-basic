import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(process.cwd());
const manifestPath = path.join(appRoot, ".next", "server", "middleware-react-loadable-manifest.js");

const MAX_CORE_TOTAL_BYTES = 640_000;
const MAX_CORE_LARGEST_CHUNK_BYTES = 425_000;
const WARN_CORE_TOTAL_BYTES = 600_000;
const WARN_CORE_LARGEST_CHUNK_BYTES = 400_000;

function readManifestJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Could not find loadable manifest at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const prefix = "self.__REACT_LOADABLE_MANIFEST=";
  if (!raw.startsWith(prefix) || !raw.endsWith(";")) {
    throw new Error(`Unexpected manifest format in ${filePath}`);
  }
  const serialized = raw.slice(prefix.length, -1).trim();
  if (serialized.startsWith("'") && serialized.endsWith("'")) {
    return JSON.parse(serialized.slice(1, -1));
  }
  return JSON.parse(serialized);
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getChunkSize(filePath) {
  return fs.statSync(filePath).size;
}

const manifest = readManifestJson(manifestPath);
const coreEntry = manifest["components/adminConsoleLoader.js -> ./AdminConsoleCore"];

if (!coreEntry?.files?.length) {
  throw new Error("AdminConsoleCore entry was not found in the loadable manifest.");
}

const chunkSizes = coreEntry.files.map((relativeFile) => {
  const chunkPath = path.join(appRoot, ".next", relativeFile);
  return {
    relativeFile,
    bytes: getChunkSize(chunkPath),
  };
});

const totalBytes = chunkSizes.reduce((sum, chunk) => sum + chunk.bytes, 0);
const largestChunkBytes = chunkSizes.reduce((max, chunk) => Math.max(max, chunk.bytes), 0);
const details = chunkSizes
  .sort((a, b) => b.bytes - a.bytes)
  .map((chunk) => `${chunk.relativeFile}: ${formatBytes(chunk.bytes)}`)
  .join(", ");

if (totalBytes > MAX_CORE_TOTAL_BYTES || largestChunkBytes > MAX_CORE_LARGEST_CHUNK_BYTES) {
  throw new Error(
    [
      "AdminConsoleCore startup bundle exceeded the allowed size budget.",
      `Largest chunk: ${formatBytes(largestChunkBytes)} (limit ${formatBytes(MAX_CORE_LARGEST_CHUNK_BYTES)})`,
      `Total lazy import: ${formatBytes(totalBytes)} (limit ${formatBytes(MAX_CORE_TOTAL_BYTES)})`,
      `Chunks: ${details}`,
    ].join(" ")
  );
}

if (totalBytes > WARN_CORE_TOTAL_BYTES || largestChunkBytes > WARN_CORE_LARGEST_CHUNK_BYTES) {
  console.warn(
    [
      "Warning: AdminConsoleCore startup bundle is approaching the size budget.",
      `Largest chunk: ${formatBytes(largestChunkBytes)} (warn at ${formatBytes(WARN_CORE_LARGEST_CHUNK_BYTES)})`,
      `Total lazy import: ${formatBytes(totalBytes)} (warn at ${formatBytes(WARN_CORE_TOTAL_BYTES)})`,
      `Chunks: ${details}`,
    ].join(" ")
  );
} else {
  console.log(
    [
      "AdminConsoleCore chunk budget check passed.",
      `Largest chunk: ${formatBytes(largestChunkBytes)}`,
      `Total lazy import: ${formatBytes(totalBytes)}`,
    ].join(" ")
  );
}
