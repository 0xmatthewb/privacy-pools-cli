import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const installVerificationModulePath = join(
  repoRoot,
  "scripts",
  "lib",
  "install-verification.mjs",
);
const nativeDistributionModulePath = join(
  repoRoot,
  "src",
  "native-distribution.js",
);
const { npmCommand, packTarball } = await import(
  pathToFileURL(installVerificationModulePath).href
);
const {
  isSupportedInstallNodeVersion,
  unsupportedInstallNodeMessage,
} = await import(pathToFileURL(installVerificationModulePath).href);
const { nativeTriplet } = await import(
  pathToFileURL(nativeDistributionModulePath).href
);
const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: options.timeout ?? 1_200_000,
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    env: buildTestRunnerEnv(options.env),
  });

  if (result.error) {
    fail(
      `Failed to execute ${command} ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    if (options.capture) {
      fail(
        `Command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim(),
      );
    }
    process.exit(result.status ?? 1);
  }

  return result;
}

function nativeBinaryPath() {
  const binName =
    process.platform === "win32"
      ? "privacy-pools-cli-native-shell.exe"
      : "privacy-pools-cli-native-shell";
  return join(repoRoot, "native", "shell", "target", "release", binName);
}

const distIndexPath = join(repoRoot, "dist", "index.js");
const tempRoot = mkdtempSync(join(tmpdir(), "pp-install-profile-"));
const cliTarballDir = join(tempRoot, "cli");
const nativeTarballDir = join(tempRoot, "native");

mkdirSync(cliTarballDir, { recursive: true });
mkdirSync(nativeTarballDir, { recursive: true });

try {
  run(npmCommand, ["run", "build"]);

  if (!existsSync(distIndexPath)) {
    fail("dist/index.js not found after npm run build.");
  }

  const cliTarball = packTarball(repoRoot, cliTarballDir, {
    npmStateRoot: tempRoot,
    ignoreScripts: true,
  });

  run("node", [
    "scripts/run-bun-tests.mjs",
    "./test/integration/cli-packaged-smoke.integration.test.ts",
    "--timeout",
    "180000",
    "--process-timeout-ms",
    "600000",
  ], {
    env: {
      PP_INSTALL_CLI_TARBALL: cliTarball,
    },
  });

  if (!isSupportedInstallNodeVersion()) {
    process.stdout.write(
      `${unsupportedInstallNodeMessage("Installed-artifact verification")}\n`,
    );
  } else {
    run("node", [
      "scripts/verify-root-only-install.mjs",
      "--cli-tarball",
      cliTarball,
    ]);

    const triplet = nativeTriplet();
    const cargoCheck = triplet
      ? spawnSync(cargoCommand, ["--version"], {
          cwd: repoRoot,
          encoding: "utf8",
          timeout: 15_000,
        })
      : null;

    if (!triplet) {
      process.stdout.write(
        `Skipped current-host native install profile on unsupported host ${process.platform}/${process.arch}; root-only install path verified.\n`,
      );
    } else if (!cargoCheck || cargoCheck.error || cargoCheck.status !== 0) {
      process.stdout.write(
        `Skipped current-host native install profile because cargo is unavailable on ${process.platform}/${process.arch}; root-only install path verified.\n`,
      );
    } else {
      run(cargoCommand, [
        "build",
        "--manifest-path",
        "native/shell/Cargo.toml",
        "--release",
      ]);

      const nativePackResult = run("node", [
        "scripts/pack-native-tarball.mjs",
        "--triplet",
        triplet,
        "--out-dir",
        nativeTarballDir,
        "--binary",
        nativeBinaryPath(),
      ], { capture: true });
      const nativeTarball = nativePackResult.stdout.trim();

      run("node", [
        "scripts/run-bun-tests.mjs",
        "./test/integration/cli-native-package-smoke.integration.test.ts",
        "--timeout",
        "240000",
        "--process-timeout-ms",
        "900000",
      ], {
        env: {
          PP_INSTALL_NATIVE_TARBALL: nativeTarball,
          PP_INSTALL_USE_EXISTING_DIST: "1",
        },
      });

      run("node", [
        "scripts/verify-release-install.mjs",
        "--cli-tarball",
        cliTarball,
        "--native-tarball",
        nativeTarball,
      ]);
    }
  }

  process.stdout.write(
    `Verified install profile using prepared artifacts from ${cliTarballDir}\n`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
