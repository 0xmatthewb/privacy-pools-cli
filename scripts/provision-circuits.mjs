import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);

const CIRCUIT_SOURCES = {
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

const ARTIFACT_CHECKSUMS = {
  "v1.1.0": {
    "commitment.wasm":
      "254d2130607182fd6fd1aee67971526b13cfe178c88e360da96dce92663828d8",
    "commitment.zkey":
      "494ae92d64098fda2a5649690ddc5821fcd7449ca5fe8ef99ee7447544d7e1f3",
    "commitment.vkey":
      "7d48b4eb3dedc12fb774348287b587f0c18c3c7254cd60e9cf0f8b3636a570d8",
    "withdraw.wasm":
      "36cda22791def3d520a55c0fc808369cd5849532a75fab65686e666ed3d55c10",
    "withdraw.zkey":
      "2a893b42174c813566e5c40c715a8b90cd49fc4ecf384e3a6024158c3d6de677",
    "withdraw.vkey":
      "666bd0983b20c1611543b04f7712e067fbe8cad69f07ada8a310837ff398d21e",
  },
};

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
    await readFile(resolve(sdkRoot, "package.json"), "utf8")
  );

  const version = sdkPkg.version;
  const tag = `v${version}`;
  const checksums = ARTIFACT_CHECKSUMS[tag];
  if (!checksums) {
    throw new Error(
      `No circuit checksum manifest is defined for ${tag}. Update the CLI before provisioning artifacts for this SDK version.`
    );
  }
  const configDir =
    process.env.PRIVACY_POOLS_HOME?.trim() ||
    process.env.PRIVACY_POOLS_CONFIG_DIR?.trim() ||
    resolve(homedir(), ".privacy-pools");
  const artifactsDir = process.env.PRIVACY_POOLS_CIRCUITS_DIR?.trim()
    ? resolve(process.env.PRIVACY_POOLS_CIRCUITS_DIR)
    : resolve(configDir, "circuits", tag);

  await mkdir(artifactsDir, { recursive: true });

  let downloaded = 0;
  let skipped = 0;

  for (const [filename, sourcePath] of Object.entries(CIRCUIT_SOURCES)) {
    const destination = resolve(artifactsDir, filename);
    if (await exists(destination)) {
      if (await sha256File(destination) === checksums[filename]) {
        console.log(`skip ${filename}`);
        skipped += 1;
        continue;
      }
      await unlink(destination).catch(() => undefined);
    }

    const url =
      `https://raw.githubusercontent.com/0xbow-io/privacy-pools-core/${tag}/${sourcePath}`;
    console.log(`download ${filename}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to download ${filename} from ${url}: HTTP ${response.status}`
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualHash = sha256Bytes(bytes);
    if (actualHash !== checksums[filename]) {
      throw new Error(
        `Checksum mismatch for ${filename} (${tag}). Expected ${checksums[filename]}, got ${actualHash}`
      );
    }

    await writeFileAtomic(destination, bytes);
    downloaded += 1;
    continue;
  }

  console.log(
    `circuits ready in ${artifactsDir} (downloaded=${downloaded}, skipped=${skipped})`
  );
}

await main();
