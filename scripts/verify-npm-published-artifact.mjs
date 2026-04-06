import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fail, npmCommand, parseArgs } from "./lib/install-verification.mjs";

const VERIFY_RETRY_DELAY_MS = 5_000;
const VERIFY_TIMEOUT_MS = 180_000;

export function integrityForBuffer(buffer) {
  return `sha512-${createHash("sha512").update(buffer).digest("base64")}`;
}

export function normalizeViewedPackageMetadata(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const dist =
    raw.dist && typeof raw.dist === "object" && !Array.isArray(raw.dist)
      ? raw.dist
      : {};

  return {
    name: typeof raw.name === "string" ? raw.name : null,
    version: typeof raw.version === "string" ? raw.version : null,
    integrity:
      typeof dist.integrity === "string"
        ? dist.integrity
        : typeof raw["dist.integrity"] === "string"
          ? raw["dist.integrity"]
          : null,
    tarball:
      typeof dist.tarball === "string"
        ? dist.tarball
        : typeof raw["dist.tarball"] === "string"
          ? raw["dist.tarball"]
          : null,
  };
}

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/verify-npm-published-artifact.mjs --package <name> --version <version> --tarball <path> [--timeout-ms <ms>]\n",
  );
  process.exit(2);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function readPublishedPackageMetadata(packageName, version) {
  const result = spawnSync(
    npmCommand,
    [
      "view",
      `${packageName}@${version}`,
      "name",
      "version",
      "dist.integrity",
      "dist.tarball",
      "--json",
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    },
  );

  if (result.error) {
    throw new Error(
      `npm view ${packageName}@${version} failed: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `npm view ${packageName}@${version} exited with status ${result.status}:\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim(),
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Failed to parse npm view JSON for ${packageName}@${version}: ${
        error instanceof Error ? error.message : String(error)
      }\n${result.stdout}`,
    );
  }

  const metadata = normalizeViewedPackageMetadata(parsed);
  if (!metadata) {
    throw new Error(
      `npm view ${packageName}@${version} returned an unexpected payload:\n${result.stdout}`,
    );
  }

  return metadata;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    usageAndExit();
  }

  const packageName = args.package?.trim();
  const version = args.version?.trim();
  const tarball = args.tarball?.trim();
  const timeoutMs = Number(args["timeout-ms"] ?? `${VERIFY_TIMEOUT_MS}`);

  if (!packageName || !version || !tarball) {
    usageAndExit();
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail(`Invalid --timeout-ms value: ${args["timeout-ms"]}`);
  }

  const tarballPath = resolve(tarball);
  const localIntegrity = integrityForBuffer(readFileSync(tarballPath));
  const deadline = Date.now() + timeoutMs;
  let lastMetadata = null;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const metadata = readPublishedPackageMetadata(packageName, version);
      lastMetadata = metadata;
      lastError = null;

      if (
        metadata.name === packageName
        && metadata.version === version
        && metadata.integrity === localIntegrity
      ) {
        process.stdout.write(
          `Verified npm registry artifact identity for ${packageName}@${version} (${metadata.integrity})${metadata.tarball ? ` from ${metadata.tarball}` : ""}\n`,
        );
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(VERIFY_RETRY_DELAY_MS);
  }

  const details = lastMetadata
    ? [
        `registry name=${lastMetadata.name ?? "<missing>"}`,
        `registry version=${lastMetadata.version ?? "<missing>"}`,
        `registry integrity=${lastMetadata.integrity ?? "<missing>"}`,
        `registry tarball=${lastMetadata.tarball ?? "<missing>"}`,
        `local integrity=${localIntegrity}`,
      ].join("\n")
    : `local integrity=${localIntegrity}`;
  const trailingError = lastError
    ? `\nlast error=${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    : "";

  fail(
    `Timed out verifying npm registry artifact identity for ${packageName}@${version}.\n${details}${trailingError}`,
  );
}

const isMain =
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
