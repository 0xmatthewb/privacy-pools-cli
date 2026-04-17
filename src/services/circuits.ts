import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIError } from "../utils/errors.js";
import defaultArtifactChecksums from "./circuit-checksums.js";
import {
  ALL_CIRCUIT_FILES,
  bundledCircuitsDir,
  CIRCUIT_FILES,
  sdkTagFromVersion,
} from "./circuit-assets.js";

const require = createRequire(import.meta.url);

type CircuitArtifacts = {
  wasm: string;
  zkey: string;
  vkey: string;
};

type CircuitName = "commitment" | "withdraw";

type SdkInstall = {
  version: string;
  tag: string;
  bundledArtifactsDir: string;
  overrideArtifactsDir: string | null;
};

const DEFAULT_ARTIFACT_CHECKSUMS: Record<string, Record<string, string>> =
  defaultArtifactChecksums;

let cachedSdkInstall: SdkInstall | null = null;
let cachedArtifactsDir: string | null = null;
let artifactChecksums = DEFAULT_ARTIFACT_CHECKSUMS;

function resolvePackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function resolveSdkInstall(): SdkInstall {
  if (cachedSdkInstall) return cachedSdkInstall;

  const sdkEntry = require.resolve("@0xbow/privacy-pools-core-sdk");
  const sdkRoot = resolve(dirname(sdkEntry), "..", "..");
  const sdkPkg = JSON.parse(
    readFileSyncUtf8(resolve(sdkRoot, "package.json"))
  ) as { version?: string };
  const version = sdkPkg.version?.trim();

  if (!version) {
    throw new CLIError(
      "Could not determine the installed Privacy Pools SDK version.",
      "PROOF",
      "Reinstall the CLI or set PRIVACY_POOLS_CIRCUITS_DIR to a directory containing the circuit artifacts.",
      "PROOF_GENERATION_FAILED",
      false,
      undefined,
      undefined,
      "guide/troubleshooting",
    );
  }

  const tag = sdkTagFromVersion(version);
  const override = process.env.PRIVACY_POOLS_CIRCUITS_DIR?.trim();

  cachedSdkInstall = {
    version,
    tag,
    bundledArtifactsDir: bundledCircuitsDir(resolvePackageRoot(), version),
    overrideArtifactsDir: override ? resolve(override) : null,
  };

  return cachedSdkInstall;
}

function readFileSyncUtf8(path: string): string {
  const fs = require("node:fs") as typeof import("node:fs");
  return fs.readFileSync(path, "utf8");
}

function checksumManifest(tag: string): Record<string, string> {
  const checksums = artifactChecksums[tag];
  if (!checksums) {
    throw new CLIError(
      `No circuit checksum manifest is defined for ${tag}.`,
      "PROOF",
      "Update the CLI to a version that knows how to verify this SDK release, or pre-provision matching artifacts after updating the checksum manifest.",
      "PROOF_GENERATION_FAILED",
      false,
      undefined,
      undefined,
      "guide/troubleshooting",
    );
  }
  return checksums;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await readFile(path));
}

async function invalidFiles(dir: string, tag: string): Promise<string[]> {
  const checksums = checksumManifest(tag);
  const invalid: string[] = [];

  for (const file of ALL_CIRCUIT_FILES) {
    const path = resolve(dir, file);
    if (!existsSync(path)) {
      invalid.push(file);
      continue;
    }

    if ((await sha256File(path)) !== checksums[file]) {
      invalid.push(file);
    }
  }

  return invalid;
}

function buildMissingArtifactsError(
  checkedDirs: string[],
  remaining: string[],
): CLIError {
  const locationText =
    checkedDirs.length === 1
      ? checkedDirs[0]!
      : `${checkedDirs.join(" or ")}`;

  return new CLIError(
    "Circuit artifacts are missing or failed verification for local proof generation.",
    "PROOF",
    `Checked ${locationText}. Missing or invalid: ${remaining.join(", ")}. Reinstall the CLI, or set PRIVACY_POOLS_CIRCUITS_DIR to a trusted pre-provisioned directory.`,
    "PROOF_GENERATION_FAILED",
    false,
    undefined,
    undefined,
    "guide/troubleshooting",
  );
}

export async function ensureCircuitArtifacts(): Promise<string> {
  if (cachedArtifactsDir) return cachedArtifactsDir;

  const install = resolveSdkInstall();
  const checkedDirs: string[] = [];
  const candidates = [
    install.overrideArtifactsDir,
    install.bundledArtifactsDir,
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of candidates) {
    checkedDirs.push(dir);
    const remaining = await invalidFiles(dir, install.tag);
    if (remaining.length === 0) {
      cachedArtifactsDir = dir;
      return cachedArtifactsDir;
    }
  }

  const primaryDir =
    install.overrideArtifactsDir ?? install.bundledArtifactsDir;
  throw buildMissingArtifactsError(
    checkedDirs,
    await invalidFiles(primaryDir, install.tag),
  );
}

export async function getCircuitArtifactPaths(
  name: CircuitName
): Promise<CircuitArtifacts> {
  const artifactsDir = await ensureCircuitArtifacts();
  const files = CIRCUIT_FILES[name];
  return {
    wasm: resolve(artifactsDir, files.wasm),
    zkey: resolve(artifactsDir, files.zkey),
    vkey: resolve(artifactsDir, files.vkey),
  };
}

export function resetCircuitArtifactsCacheForTests(): void {
  cachedSdkInstall = null;
  cachedArtifactsDir = null;
  artifactChecksums = DEFAULT_ARTIFACT_CHECKSUMS;
}

export function overrideCircuitChecksumsForTests(
  manifest: Record<string, Record<string, string>>
): void {
  artifactChecksums = manifest;
}
