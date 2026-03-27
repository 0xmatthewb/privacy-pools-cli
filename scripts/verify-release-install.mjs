import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const rootPackageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
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
    "Usage: node scripts/verify-release-install.mjs --cli-tarball <path> --native-tarball <path> [--version <version>]\n",
  );
  process.exit(2);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseJson(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`${label} did not emit valid JSON:\n${reason}\n${stdout}`);
  }
}

function runCli(cliEntryPath, installRoot, homeDir, args, options = {}) {
  const result = spawnSync(process.execPath, [cliEntryPath, ...args], {
    cwd: installRoot,
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PP_NO_UPDATE_CHECK: "1",
      NO_COLOR: "1",
      PRIVACY_POOLS_HOME: homeDir,
      ...options.env,
    },
  });

  if (result.error) {
    fail(
      `Failed to execute privacy-pools ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  return result;
}

const args = parseArgs(process.argv.slice(2));
const cliTarball = args["cli-tarball"]?.trim();
const nativeTarball = args["native-tarball"]?.trim();

if (!cliTarball || !nativeTarball) {
  usageAndExit();
}

const expectedVersion = args.version?.trim() || rootPackageJson.version;
const cliTarballPath = resolve(cliTarball);
const nativeTarballPath = resolve(nativeTarball);
const installRoot = mkdtempSync(join(tmpdir(), "pp-release-install-"));
const npmCacheDir = join(installRoot, ".npm-cache");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cliEntryPath = join(
  installRoot,
  "node_modules",
  rootPackageJson.name,
  "dist",
  "index.js",
);
const homeDir = join(installRoot, ".privacy-pools");

try {
  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({
      name: "pp-release-install-check",
      private: true,
    }),
    "utf8",
  );

  const installResult = spawnSync(
    npmCommand,
    [
      "install",
      "--silent",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      cliTarballPath,
      nativeTarballPath,
    ],
    {
      cwd: installRoot,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_cache: npmCacheDir,
      },
    },
  );

  if (installResult.error) {
    fail(
      `Failed to execute npm install for release tarballs:\n${installResult.error.message}`,
    );
  }

  if (installResult.status !== 0) {
    fail(
      `Failed to install release tarballs:\n${installResult.stderr}\n${installResult.stdout}`,
    );
  }

  const versionResult = runCli(cliEntryPath, installRoot, homeDir, ["--version"]);
  if (versionResult.status !== 0 || versionResult.stdout.trim() !== expectedVersion) {
    fail(
      `Installed release CLI returned an unexpected version:\nstatus=${versionResult.status}\nstdout=${versionResult.stdout}\nstderr=${versionResult.stderr}`,
    );
  }

  const helpResult = runCli(cliEntryPath, installRoot, homeDir, ["--help"]);
  if (helpResult.status !== 0 || !helpResult.stdout.includes("privacy-pools")) {
    fail(
      `Installed release CLI help failed:\nstatus=${helpResult.status}\nstdout=${helpResult.stdout}\nstderr=${helpResult.stderr}`,
    );
  }

  // If the launcher failed to resolve the installed native package and fell
  // back to JS, this would fail before executing because the JS worker path is
  // invalid. A successful static command proves same-version native resolution.
  const nativeResolutionResult = runCli(
    cliEntryPath,
    installRoot,
    homeDir,
    ["--agent", "capabilities"],
    {
      env: {
        PRIVACY_POOLS_CLI_JS_WORKER: join(installRoot, "missing-worker.js"),
      },
    },
  );
  const capabilitiesPayload = parseJson(
    nativeResolutionResult.stdout,
    "capabilities --agent",
  );
  if (
    nativeResolutionResult.status !== 0 ||
    capabilitiesPayload.success !== true ||
    capabilitiesPayload.runtime?.cliVersion !== expectedVersion
  ) {
    fail(
      `Installed release CLI failed native launcher resolution:\nstatus=${nativeResolutionResult.status}\nstdout=${nativeResolutionResult.stdout}\nstderr=${nativeResolutionResult.stderr}`,
    );
  }

  const statusResult = runCli(
    cliEntryPath,
    installRoot,
    homeDir,
    ["--agent", "status", "--no-check"],
  );
  const statusPayload = parseJson(statusResult.stdout, "status --agent --no-check");
  if (statusResult.status !== 0 || statusPayload.success !== true) {
    fail(
      `Installed release CLI failed JS-forwarded status:\nstatus=${statusResult.status}\nstdout=${statusResult.stdout}\nstderr=${statusResult.stderr}`,
    );
  }

  const statsResult = runCli(
    cliEntryPath,
    installRoot,
    homeDir,
    ["--agent", "stats"],
    {
      env: {
        PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
      },
    },
  );
  const statsPayload = parseJson(statsResult.stdout, "stats --agent");
  if (
    statsResult.status !== 3 ||
    statsPayload.success !== false ||
    statsPayload.errorCode !== "RPC_NETWORK_ERROR"
  ) {
    fail(
      `Installed release CLI failed native read-only error parity:\nstatus=${statsResult.status}\nstdout=${statsResult.stdout}\nstderr=${statsResult.stderr}`,
    );
  }

  process.stdout.write(
    `verified installed release artifacts for privacy-pools-cli@${expectedVersion}\n`,
  );
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
