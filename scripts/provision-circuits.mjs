import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import checksumsByTag from "../src/services/circuit-checksums.js";
import {
  ALL_CIRCUIT_FILES,
  bundledCircuitsDir,
  sdkTagFromVersion,
} from "../src/services/circuit-assets.js";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

async function writeFileAtomic(path, bytes) {
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, bytes);
  try {
    await rename(tmpPath, path);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

async function main() {
  const sdkEntry = require.resolve("@0xbow/privacy-pools-core-sdk");
  const sdkRoot = resolve(dirname(sdkEntry), "..", "..");
  const sdkPkg = JSON.parse(
    await readFile(resolve(sdkRoot, "package.json"), "utf8"),
  );

  const version = sdkPkg.version?.trim();
  if (!version) {
    throw new Error("Could not determine the installed Privacy Pools SDK version.");
  }

  const tag = sdkTagFromVersion(version);
  const checksums = checksumsByTag[tag];
  if (!checksums) {
    throw new Error(
      `No circuit checksum manifest is defined for ${tag}. Update the CLI before provisioning artifacts for this SDK version.`,
    );
  }

  const configDir =
    process.env.PRIVACY_POOLS_HOME?.trim()
    || process.env.PRIVACY_POOLS_CONFIG_DIR?.trim()
    || resolve(homedir(), ".privacy-pools");
  const artifactsDir = process.env.PRIVACY_POOLS_CIRCUITS_DIR?.trim()
    ? resolve(process.env.PRIVACY_POOLS_CIRCUITS_DIR)
    : resolve(configDir, "circuits", tag);
  const bundledDir = bundledCircuitsDir(repoRoot, version);

  await mkdir(artifactsDir, { recursive: true });

  let copied = 0;
  let skipped = 0;

  for (const filename of ALL_CIRCUIT_FILES) {
    const sourcePath = resolve(bundledDir, filename);
    if (!(await exists(sourcePath))) {
      throw new Error(
        `Bundled circuit artifact is missing: ${sourcePath}. Reinstall the CLI or refresh the bundled circuit assets.`,
      );
    }

    const sourceBytes = await readFile(sourcePath);
    const sourceHash = sha256Bytes(sourceBytes);
    if (sourceHash !== checksums[filename]) {
      throw new Error(
        `Bundled circuit checksum mismatch for ${filename} (${tag}). Expected ${checksums[filename]}, got ${sourceHash}.`,
      );
    }

    const destination = resolve(artifactsDir, filename);
    if (await exists(destination)) {
      if ((await sha256File(destination)) === checksums[filename]) {
        console.log(`skip ${filename}`);
        skipped += 1;
        continue;
      }
      await unlink(destination).catch(() => undefined);
    }

    await writeFileAtomic(destination, sourceBytes);
    console.log(`copy ${filename}`);
    copied += 1;
  }

  console.log(
    `circuits ready in ${artifactsDir} (copied=${copied}, skipped=${skipped})`,
  );
}

await main();
