import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(process.cwd());
const manifestPath = path.join(appRoot, ".next", "server", "middleware-react-loadable-manifest.js");
const MAX_WRAPPER_BYTES = 120_000;
const WARN_WRAPPER_BYTES = 80_000;
const MAX_CORE_TOTAL_BYTES = 400_000;
const WARN_CORE_TOTAL_BYTES = 320_000;
const WORKSPACE_BUDGETS = {
  announcements: { max: 80_000, warn: 60_000, entry: "components/adminConsoleLoader.js -> ./AdminConsoleAnnouncementsWorkspace" },
  students: { max: 140_000, warn: 100_000, entry: "components/adminConsoleLoader.js -> ./AdminConsoleStudentsWorkspace" },
  dailyRecord: { max: 140_000, warn: 100_000, entry: "components/adminConsoleLoader.js -> ./AdminConsoleDailyRecordWorkspace" },
  ranking: { max: 140_000, warn: 100_000, entry: "components/adminConsoleLoader.js -> ./AdminConsoleRankingWorkspace" },
  attendance: { max: 180_000, warn: 140_000, entry: "components/adminConsoleLoader.js -> ./AdminConsoleAttendanceWorkspace" },
  testing: { max: 220_000, warn: 180_000, entry: "components/adminConsoleLoader.js -> ./AdminConsoleTestingWorkspace" },
};
const REQUIRED_WORKSPACE_ENTRIES = [
  ...Object.values(WORKSPACE_BUDGETS).map((workspace) => workspace.entry),
];
const REQUIRED_WRAPPER_ENTRY = "components/adminConsoleLoader.js -> ./AdminConsole";
const REQUIRED_CORE_ENTRY = "components/adminConsoleLoader.js -> ./AdminConsoleCore";

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
const wrapperEntry = manifest[REQUIRED_WRAPPER_ENTRY];
const coreEntry = manifest[REQUIRED_CORE_ENTRY];

if (!wrapperEntry?.files?.length) {
  throw new Error(`Admin console wrapper entry is missing from the loadable manifest: ${REQUIRED_WRAPPER_ENTRY}`);
}

const missingWorkspaceEntries = REQUIRED_WORKSPACE_ENTRIES.filter((entryKey) => !manifest[entryKey]?.files?.length);

if (missingWorkspaceEntries.length) {
  throw new Error(
    `Admin console workspace entries are missing from the loadable manifest: ${missingWorkspaceEntries.join(", ")}`
  );
}

if (!coreEntry?.files?.length) {
  throw new Error(`Admin console core entry is missing from the loadable manifest: ${REQUIRED_CORE_ENTRY}`);
}

const wrapperArtifactPath = resolveBuildArtifactPath(wrapperEntry.files[0]);
const wrapperBytes = getChunkSize(wrapperArtifactPath);

if (wrapperBytes > MAX_WRAPPER_BYTES) {
  throw new Error(
    [
      "Admin console wrapper startup artifact exceeded the allowed size budget.",
      `AdminConsole wrapper: ${formatBytes(wrapperBytes)} (limit ${formatBytes(MAX_WRAPPER_BYTES)})`,
    ].join(" ")
  );
}

const coreChunkSizes = (coreEntry?.files ?? [])
  .map((relativeFile) => {
    const chunkPath = tryResolveDirectBuildArtifactPath(relativeFile);
    if (!chunkPath) return null;
    return {
      relativeFile,
      bytes: getChunkSize(chunkPath),
    };
  })
  .filter(Boolean);
const coreTotalBytes = coreChunkSizes.reduce((sum, chunk) => sum + chunk.bytes, 0);
const coreDetails = coreChunkSizes
  .sort((a, b) => b.bytes - a.bytes)
  .map((chunk) => `${chunk.relativeFile}: ${formatBytes(chunk.bytes)}`)
  .join(", ");

if (coreTotalBytes > MAX_CORE_TOTAL_BYTES) {
  throw new Error(
    [
      "Admin console core import exceeded the allowed size budget.",
      `AdminConsole core: ${formatBytes(coreTotalBytes)} (limit ${formatBytes(MAX_CORE_TOTAL_BYTES)})`,
      `Chunks: ${coreDetails}`,
    ].join(" ")
  );
}

const warnings = [];
if (wrapperBytes > WARN_WRAPPER_BYTES) {
  warnings.push(`AdminConsole wrapper: ${formatBytes(wrapperBytes)} (warn at ${formatBytes(WARN_WRAPPER_BYTES)})`);
}
if (coreTotalBytes > WARN_CORE_TOTAL_BYTES) {
  warnings.push(`AdminConsole core: ${formatBytes(coreTotalBytes)} (warn at ${formatBytes(WARN_CORE_TOTAL_BYTES)})`);
}

const workspaceSummaries = Object.entries(WORKSPACE_BUDGETS).map(([workspaceKey, config]) => {
  const entry = manifest[config.entry];
  const chunks = (entry?.files ?? [])
    .map((relativeFile) => {
      const chunkPath = tryResolveDirectBuildArtifactPath(relativeFile);
      if (!chunkPath) return null;
      return {
        relativeFile,
        bytes: getChunkSize(chunkPath),
      };
    })
    .filter(Boolean);
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  if (totalBytes > config.max) {
    throw new Error(
      [
        `Admin console ${workspaceKey} workspace exceeded the allowed size budget.`,
        `${workspaceKey}: ${formatBytes(totalBytes)} (limit ${formatBytes(config.max)})`,
        `Chunks: ${chunks.map((chunk) => `${chunk.relativeFile}: ${formatBytes(chunk.bytes)}`).join(", ")}`,
      ].join(" ")
    );
  }
  if (totalBytes > config.warn) {
    warnings.push(`${workspaceKey}: ${formatBytes(totalBytes)} (warn at ${formatBytes(config.warn)})`);
  }
  return `${workspaceKey} ${formatBytes(totalBytes)}`;
});

if (warnings.length) {
  console.warn(
    [
      "Warning: Admin console chunk budgets are approaching limits.",
      ...warnings,
    ].join(" ")
  );
}

console.log(
  [
    "Admin console chunk budget check passed.",
    `AdminConsole wrapper: ${formatBytes(wrapperBytes)}`,
    `AdminConsole core: ${formatBytes(coreTotalBytes)}`,
    `Workspace entries: ${workspaceSummaries.join(", ")}`,
  ].join(" ")
);
