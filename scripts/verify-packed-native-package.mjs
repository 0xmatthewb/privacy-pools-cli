import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { npmProcessEnv, runNpmInstallWithRetry } from "./lib/install-verification.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const packageJsonPath = join(repoRoot, "package.json");
const runtimeContractModulePath = join(
  repoRoot,
  "src",
  "runtime",
  "runtime-contract.js",
);
const nativeDistributionModulePath = join(
  repoRoot,
  "src",
  "native-distribution.js",
);
const nativePackageMetadataModulePath = join(
  repoRoot,
  "src",
  "native-package-metadata.js",
);

const rootPackageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const {
  CURRENT_RUNTIME_DESCRIPTOR,
} = await import(pathToFileURL(runtimeContractModulePath).href);
const { nativePackageNameForTriplet } = await import(
  pathToFileURL(nativeDistributionModulePath).href
);
const {
  resolveNativeBinaryPath,
  resolveNativeBridgeVersion,
  sha256File,
} = await import(pathToFileURL(nativePackageMetadataModulePath).href);
const protocolProfileModulePath = join(
  repoRoot,
  "src",
  "config",
  "protocol-profile.js",
);
const { CLI_PROTOCOL_PROFILE } = await import(
  pathToFileURL(protocolProfileModulePath).href
);

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

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/verify-packed-native-package.mjs --triplet <triplet> --tarball <path> [--version <version>]\n",
  );
  process.exit(2);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const triplet = args.triplet?.trim();
const tarball = args.tarball?.trim();

if (!triplet || !tarball) {
  usageAndExit();
}

const expectedVersion = args.version?.trim() || rootPackageJson.version;
const tarballPath = resolve(tarball);
const installRoot = mkdtempSync(join(tmpdir(), "pp-native-tarball-"));
const packageName = nativePackageNameForTriplet(triplet);

if (!packageName) {
  fail(`Unsupported native triplet ${triplet}.`);
}

try {
  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({
      name: "pp-native-tarball-check",
      private: true,
    }),
    "utf8",
  );

  const installResult = runNpmInstallWithRetry(
    [
      "install",
      "--silent",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarballPath,
    ],
    {
      cwd: installRoot,
      env: npmProcessEnv(installRoot),
    },
  );

  if (installResult.error) {
    fail(
      `Failed to execute npm install for packed native tarball ${tarballPath}:\n${installResult.error.message}`,
    );
  }

  if (installResult.status !== 0) {
    fail(
      `Failed to install packed native tarball ${tarballPath}:\n${installResult.stderr}\n${installResult.stdout}`,
    );
  }

  const installedPackageJsonPath = join(
    installRoot,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );

  if (!existsSync(installedPackageJsonPath)) {
    fail(`Installed native package is missing ${installedPackageJsonPath}.`);
  }

  const installedPackageJson = JSON.parse(
    readFileSync(installedPackageJsonPath, "utf8"),
  );
  const metadata = installedPackageJson.privacyPoolsCliNative ?? {};
  const bridgeVersion = resolveNativeBridgeVersion(metadata);

  if (installedPackageJson.name !== packageName) {
    fail(
      `Packed native package name mismatch: expected ${packageName}, got ${installedPackageJson.name ?? "<missing>"}.`,
    );
  }

  if (installedPackageJson.version !== expectedVersion) {
    fail(
      `Packed native package version mismatch: expected ${expectedVersion}, got ${installedPackageJson.version ?? "<missing>"}.`,
    );
  }

  if (metadata.triplet !== triplet) {
    fail(
      `Packed native package triplet mismatch: expected ${triplet}, got ${metadata.triplet ?? "<missing>"}.`,
    );
  }

  if (bridgeVersion !== CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion) {
    fail(
      `Packed native package bridge version mismatch: expected ${CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion}, got ${bridgeVersion ?? "<missing>"}.`,
    );
  }

  if (metadata.runtimeVersion !== CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion) {
    fail(
      `Packed native package runtime version mismatch: expected ${CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion}, got ${metadata.runtimeVersion ?? "<missing>"}.`,
    );
  }

  if (metadata.protocolProfile !== CLI_PROTOCOL_PROFILE.profile) {
    fail(
      `Packed native package protocol profile mismatch: expected ${CLI_PROTOCOL_PROFILE.profile}, got ${metadata.protocolProfile ?? "<missing>"}.`,
    );
  }

  if (!metadata.sha256) {
    fail("Packed native package is missing privacyPoolsCliNative.sha256.");
  }

  if (
    typeof installedPackageJson.bin === "string"
    || installedPackageJson.bin?.["privacy-pools"]
  ) {
    fail(
      "Packed native package must not publish the public privacy-pools bin entry.",
    );
  }

  const binaryPath = resolveNativeBinaryPath(
    installedPackageJsonPath,
    installedPackageJson,
    { allowLegacyBin: false },
  );
  if (!binaryPath) {
    fail("Packed native package is missing privacyPoolsCliNative.binaryPath.");
  }
  if (!existsSync(binaryPath)) {
    fail(`Packed native package binary is missing ${binaryPath}.`);
  }

  const actualSha256 = sha256File(binaryPath);
  if (actualSha256 !== metadata.sha256) {
    fail(
      `Packed native package checksum mismatch: expected ${metadata.sha256}, got ${actualSha256}.`,
    );
  }

  const versionResult = spawnSync(binaryPath, ["--version"], {
    cwd: installRoot,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (versionResult.status !== 0) {
    fail(
      `Packed native binary failed to execute:\n${versionResult.stderr}\n${versionResult.stdout}`,
    );
  }

  if (versionResult.stdout.trim() !== expectedVersion) {
    fail(
      `Packed native binary version output mismatch: expected ${expectedVersion}, got ${versionResult.stdout.trim() || "<empty>"}.`,
    );
  }

  process.stdout.write(
    `verified ${packageName}@${expectedVersion} (${triplet}) from ${tarballPath}\n`,
  );
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
