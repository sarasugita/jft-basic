import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(process.cwd());
const manifestPath = path.join(appRoot, ".next", "server", "middleware-react-loadable-manifest.js");
const MAX_SHELL_TOTAL_BYTES = 560_000;
const MAX_SHELL_LARGEST_CHUNK_BYTES = 340_000;
const WARN_SHELL_TOTAL_BYTES = 540_000;
const WARN_SHELL_LARGEST_CHUNK_BYTES = 320_000;
const MAX_WRAPPER_BYTES = 220_000;
const WARN_WRAPPER_BYTES = 180_000;
const REQUIRED_WORKSPACE_ENTRIES = [
  "components/adminConsoleLoader.js -> ./AdminConsoleStudentsWorkspace",
  "components/adminConsoleLoader.js -> ./AdminConsoleAttendanceWorkspace",
  "components/adminConsoleLoader.js -> ./AdminConsoleDailyRecordWorkspace",
  "components/adminConsoleLoader.js -> ./AdminConsoleRankingWorkspace",
  "components/adminConsoleLoader.js -> ./AdminConsoleAnnouncementsWorkspace",
  "components/adminConsoleLoader.js -> ./AdminConsoleTestingWorkspace",
];
const REQUIRED_STARTUP_ENTRY = "components/adminConsoleLoader.js -> ./AdminConsoleAnnouncementsStartup";

function readManifestJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Could not find loadable manifest at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const prefix = "self.__REACT_LOADABLE_MANIFEST=";
  if (!raw.startsWith(prefix)) {
    throw new Error(`Unexpected manifest format in ${filePath}`);
  }
  const suffixTrimmed = raw.endsWith(";") ? raw.slice(0, -1) : raw;
  const serialized = suffixTrimmed.slice(prefix.length).trim();
  if (serialized.startsWith("'") && serialized.endsWith("'")) {
    return JSON.parse(serialized.slice(1, -1));
  }
  if (serialized.startsWith("\"") && serialized.endsWith("\"")) {
    return JSON.parse(JSON.parse(serialized));
  }
  return JSON.parse(serialized);
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function resolveBuildArtifactPath(relativeFile) {
  const directPath = path.join(appRoot, ".next", relativeFile);
  if (fs.existsSync(directPath)) return directPath;

  const serverFallbackName = path.basename(relativeFile).replace(/^_app-pages-browser_/, "_ssr_");
  const serverFallbackPath = path.join(appRoot, ".next", "server", serverFallbackName);
  if (fs.existsSync(serverFallbackPath)) return serverFallbackPath;

  return directPath;
}

function tryResolveDirectBuildArtifactPath(relativeFile) {
  const directPath = path.join(appRoot, ".next", relativeFile);
  return fs.existsSync(directPath) ? directPath : null;
}

function getChunkSize(filePath) {
  return fs.statSync(filePath).size;
}

const manifest = readManifestJson(manifestPath);
const coreEntry = manifest["components/adminConsoleLoader.js -> ./AdminConsoleCore"];

if (!coreEntry?.files?.length) {
  throw new Error("AdminConsoleCore entry was not found in the loadable manifest.");
}

const missingWorkspaceEntries = REQUIRED_WORKSPACE_ENTRIES.filter((entryKey) => !manifest[entryKey]?.files?.length);

if (missingWorkspaceEntries.length) {
  throw new Error(
    `Admin console workspace entries are missing from the loadable manifest: ${missingWorkspaceEntries.join(", ")}`
  );
}

if (!manifest[REQUIRED_STARTUP_ENTRY]?.files?.length) {
  throw new Error(`Admin console startup entry is missing from the loadable manifest: ${REQUIRED_STARTUP_ENTRY}`);
}

const wrapperArtifactPath = resolveBuildArtifactPath(manifest["components/adminConsoleLoader.js -> ./AdminConsole"].files[0]);
const wrapperBytes = getChunkSize(wrapperArtifactPath);

if (wrapperBytes > MAX_WRAPPER_BYTES) {
  throw new Error(
    [
      "Admin console wrapper startup artifact exceeded the allowed size budget.",
      `AdminConsole wrapper: ${formatBytes(wrapperBytes)} (limit ${formatBytes(MAX_WRAPPER_BYTES)})`,
    ].join(" ")
  );
}

const chunkSizes = coreEntry.files
  .map((relativeFile) => {
    const chunkPath = tryResolveDirectBuildArtifactPath(relativeFile);
    if (!chunkPath) return null;
    return {
      relativeFile,
      bytes: getChunkSize(chunkPath),
    };
  })
  .filter(Boolean);

const totalBytes = chunkSizes.reduce((sum, chunk) => sum + chunk.bytes, 0);
const largestChunkBytes = chunkSizes.reduce((max, chunk) => Math.max(max, chunk.bytes), 0);
const details = chunkSizes
  .sort((a, b) => b.bytes - a.bytes)
  .map((chunk) => `${chunk.relativeFile}: ${formatBytes(chunk.bytes)}`)
  .join(", ");
const hasDirectCoreChunkFiles = chunkSizes.length > 0;

if (
  hasDirectCoreChunkFiles
  && (totalBytes > MAX_SHELL_TOTAL_BYTES || largestChunkBytes > MAX_SHELL_LARGEST_CHUNK_BYTES)
) {
  throw new Error(
    [
      "Admin console shell startup bundle exceeded the allowed size budget.",
      `Largest chunk: ${formatBytes(largestChunkBytes)} (limit ${formatBytes(MAX_SHELL_LARGEST_CHUNK_BYTES)})`,
      `Total shell import: ${formatBytes(totalBytes)} (limit ${formatBytes(MAX_SHELL_TOTAL_BYTES)})`,
      `Chunks: ${details}`,
    ].join(" ")
  );
}

if (
  wrapperBytes > WARN_WRAPPER_BYTES
  || (
    hasDirectCoreChunkFiles
    && (totalBytes > WARN_SHELL_TOTAL_BYTES || largestChunkBytes > WARN_SHELL_LARGEST_CHUNK_BYTES)
  )
) {
  console.warn(
    [
      "Warning: Admin console shell startup bundle is approaching the size budget.",
      `AdminConsole wrapper: ${formatBytes(wrapperBytes)} (warn at ${formatBytes(WARN_WRAPPER_BYTES)})`,
      hasDirectCoreChunkFiles
        ? `Largest chunk: ${formatBytes(largestChunkBytes)} (warn at ${formatBytes(WARN_SHELL_LARGEST_CHUNK_BYTES)})`
        : "Core chunk files unavailable in direct build output; skipped core startup chunk budget.",
      hasDirectCoreChunkFiles
        ? `Total shell import: ${formatBytes(totalBytes)} (warn at ${formatBytes(WARN_SHELL_TOTAL_BYTES)})`
        : "",
      hasDirectCoreChunkFiles ? `Chunks: ${details}` : "",
    ].join(" ")
  );
} else {
  console.log(
    [
      "Admin console shell chunk budget check passed.",
      `AdminConsole wrapper: ${formatBytes(wrapperBytes)}`,
      hasDirectCoreChunkFiles ? `Largest chunk: ${formatBytes(largestChunkBytes)}` : "Core startup chunk budget skipped",
      hasDirectCoreChunkFiles ? `Total shell import: ${formatBytes(totalBytes)}` : "",
      `Workspace entries: ${REQUIRED_WORKSPACE_ENTRIES.length}`,
    ].join(" ")
  );
}
