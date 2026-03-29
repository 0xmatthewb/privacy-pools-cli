import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import checksumsByTag from "../src/services/circuit-checksums.js";
import {
  ALL_CIRCUIT_FILES,
  bundledCircuitsDir,
  CIRCUIT_SOURCE_PATHS,
  sdkTagFromVersion,
} from "../src/services/circuit-assets.js";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const checksumsPath = resolve(repoRoot, "src", "services", "circuit-checksums.js");
const ARTIFACT_DOWNLOAD_RETRY_DELAYS_MS = [1_000, 2_000];
const ARTIFACT_DOWNLOAD_TIMEOUT_MS = 180_000;

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.split("=", 2);
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;
    result[key.slice(2)] = value;
  }
  return result;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sleepMs(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchBytes(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= ARTIFACT_DOWNLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(ARTIFACT_DOWNLOAD_TIMEOUT_MS),
      });
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
      lastError = new Error(`GET ${url} -> HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < ARTIFACT_DOWNLOAD_RETRY_DELAYS_MS.length) {
      await sleepMs(ARTIFACT_DOWNLOAD_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

async function readSourceBytes(sourceDir, filename, tag) {
  if (!sourceDir) {
    const sourcePath = CIRCUIT_SOURCE_PATHS[filename];
    const url =
      `https://raw.githubusercontent.com/0xbow-io/privacy-pools-core/${tag}/${sourcePath}`;
    return fetchBytes(url);
  }

  const directPath = resolve(sourceDir, filename);
  if (existsSync(directPath)) {
    return new Uint8Array(await readFile(directPath));
  }

  const repoLayoutPath = resolve(sourceDir, CIRCUIT_SOURCE_PATHS[filename]);
  if (existsSync(repoLayoutPath)) {
    return new Uint8Array(await readFile(repoLayoutPath));
  }

  throw new Error(
    `Could not find ${filename} in ${sourceDir}. Expected either ${directPath} or ${repoLayoutPath}.`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicitSourceDir = args["source-dir"]?.trim();
  const sourceDir = explicitSourceDir ? resolve(explicitSourceDir) : null;

  const sdkEntry = require.resolve("@0xbow/privacy-pools-core-sdk");
  const sdkRoot = resolve(dirname(sdkEntry), "..", "..");
  const sdkPkg = JSON.parse(
    readFileSync(resolve(sdkRoot, "package.json"), "utf8"),
  );
  const version = sdkPkg.version?.trim();
  if (!version) {
    throw new Error("Could not determine the installed Privacy Pools SDK version.");
  }

  const tag = sdkTagFromVersion(version);
  const destinationDir = bundledCircuitsDir(repoRoot, version);
  await mkdir(destinationDir, { recursive: true });

  const nextChecksums = {
    ...checksumsByTag,
    [tag]: {},
  };

  for (const filename of ALL_CIRCUIT_FILES) {
    const bytes = await readSourceBytes(sourceDir, filename, tag);
    const hash = sha256Bytes(bytes);
    writeFileSync(resolve(destinationDir, filename), bytes);
    nextChecksums[tag][filename] = hash;
    process.stdout.write(`refreshed ${filename}\n`);
  }

  writeFileSync(
    checksumsPath,
    `export default ${JSON.stringify(nextChecksums, null, 2)};\n`,
    "utf8",
  );

  process.stdout.write(
    `bundled circuits refreshed for ${tag} in ${destinationDir}${sourceDir ? ` from ${sourceDir}` : " from public upstream"}\n`,
  );
}

await main();
