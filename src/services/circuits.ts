import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getConfigDir } from "./config.js";
import { CLIError } from "../utils/errors.js";
import defaultArtifactChecksums from "./circuit-checksums.js";

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
  managedArtifactsDir: string;
};

const CIRCUIT_FILES: Record<CircuitName, CircuitArtifacts> = {
  commitment: {
    wasm: "commitment.wasm",
    zkey: "commitment.zkey",
    vkey: "commitment.vkey",
  },
  withdraw: {
    wasm: "withdraw.wasm",
    zkey: "withdraw.zkey",
    vkey: "withdraw.vkey",
  },
};

const CIRCUIT_SOURCES: Record<string, string> = {
  "commitment.wasm":
    "packages/circuits/build/commitment/commitment_js/commitment.wasm",
  "commitment.zkey":
    "packages/circuits/trusted-setup/final-keys/commitment.zkey",
  "commitment.vkey":
    "packages/circuits/trusted-setup/final-keys/commitment.vkey",
  "withdraw.wasm":
    "packages/circuits/build/withdraw/withdraw_js/withdraw.wasm",
  "withdraw.zkey":
    "packages/circuits/trusted-setup/final-keys/withdraw.zkey",
  "withdraw.vkey":
    "packages/circuits/trusted-setup/final-keys/withdraw.vkey",
};

const DEFAULT_ARTIFACT_CHECKSUMS: Record<string, Record<string, string>> =
  defaultArtifactChecksums;

let cachedSdkInstall: SdkInstall | null = null;
let cachedArtifactsDir: string | null = null;
let provisionPromise: Promise<string> | null = null;
let artifactChecksums = DEFAULT_ARTIFACT_CHECKSUMS;

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
      "PROOF_GENERATION_FAILED"
    );
  }

  const tag = `v${version}`;
  const override = process.env.PRIVACY_POOLS_CIRCUITS_DIR?.trim();

  cachedSdkInstall = {
    version,
    tag,
    managedArtifactsDir: override
      ? resolve(override)
      : join(getConfigDir(), "circuits", tag),
  };

  return cachedSdkInstall;
}

function readFileSyncUtf8(path: string): string {
  const fs = require("node:fs") as typeof import("node:fs");
  return fs.readFileSync(path, "utf8");
}

function allArtifactFiles(): string[] {
  return Object.values(CIRCUIT_FILES).flatMap((files) => [
    files.wasm,
    files.zkey,
    files.vkey,
  ]);
}

function checksumManifest(tag: string): Record<string, string> {
  const checksums = artifactChecksums[tag];
  if (!checksums) {
    throw new CLIError(
      `No circuit checksum manifest is defined for ${tag}.`,
      "PROOF",
      "Update the CLI to a version that knows how to verify this SDK release, or pre-provision matching artifacts after updating the checksum manifest.",
      "PROOF_GENERATION_FAILED"
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

  for (const file of allArtifactFiles()) {
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

async function writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, bytes);
  try {
    await rename(tmpPath, path);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

async function provisionArtifacts(targetDir: string, tag: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const checksums = checksumManifest(tag);

  for (const [filename, sourcePath] of Object.entries(CIRCUIT_SOURCES)) {
    const destination = resolve(targetDir, filename);
    if (existsSync(destination)) {
      if ((await sha256File(destination)) === checksums[filename]) {
        continue;
      }
      await unlink(destination).catch(() => undefined);
    }

    const url =
      `https://raw.githubusercontent.com/0xbow-io/privacy-pools-core/${tag}/${sourcePath}`;

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new CLIError(
        "Could not download circuit artifacts.",
        "PROOF",
        error instanceof Error
          ? `${error.message}. Set PRIVACY_POOLS_CIRCUITS_DIR to a pre-provisioned directory if you need offline proof generation.`
          : "Set PRIVACY_POOLS_CIRCUITS_DIR to a pre-provisioned directory if you need offline proof generation.",
        "PROOF_GENERATION_FAILED"
      );
    }

    if (!response.ok) {
      throw new CLIError(
        "Could not download circuit artifacts.",
        "PROOF",
        `Download failed for ${filename} (HTTP ${response.status}) from ${url}.`,
        "PROOF_GENERATION_FAILED"
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualHash = sha256Bytes(bytes);
    if (actualHash !== checksums[filename]) {
      throw new CLIError(
        "Circuit artifact failed integrity verification.",
        "PROOF",
        `${filename} checksum mismatch for ${tag}. Delete the local cache and retry, or set PRIVACY_POOLS_CIRCUITS_DIR to a trusted pre-provisioned directory.`,
        "PROOF_GENERATION_FAILED"
      );
    }

    await writeFileAtomic(destination, bytes);
  }
}

export async function ensureCircuitArtifacts(): Promise<string> {
  if (cachedArtifactsDir) return cachedArtifactsDir;

  const install = resolveSdkInstall();
  const targetDir = install.managedArtifactsDir;
  if ((await invalidFiles(targetDir, install.tag)).length === 0) {
    cachedArtifactsDir = targetDir;
    return cachedArtifactsDir;
  }

  if (!provisionPromise) {
    provisionPromise = provisionArtifacts(targetDir, install.tag)
      .then(() => targetDir)
      .finally(() => {
        provisionPromise = null;
      });
  }

  await provisionPromise;

  const remaining = await invalidFiles(targetDir, install.tag);
  if (remaining.length > 0) {
    throw new CLIError(
      "Circuit artifacts are missing or failed verification for local proof generation.",
      "PROOF",
      `Expected files in ${targetDir}. Missing: ${remaining.join(", ")}.`,
      "PROOF_GENERATION_FAILED"
    );
  }

  cachedArtifactsDir = targetDir;
  return cachedArtifactsDir;
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
  provisionPromise = null;
  artifactChecksums = DEFAULT_ARTIFACT_CHECKSUMS;
}

export function overrideCircuitChecksumsForTests(
  manifest: Record<string, Record<string, string>>
): void {
  artifactChecksums = manifest;
}
