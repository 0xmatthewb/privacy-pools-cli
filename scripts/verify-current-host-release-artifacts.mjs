import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const VERIFY_ROOT_ONLY_INSTALL = join(
  repoRoot,
  "scripts",
  "verify-root-only-install.mjs",
);
const nativeDistributionModulePath = join(
  repoRoot,
  "src",
  "native-distribution.js",
);
const { nativeTriplet } = await import(
  pathToFileURL(nativeDistributionModulePath).href
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";

function nativeBinaryPath() {
  const binName =
    process.platform === "win32"
      ? "privacy-pools-cli-native-shell.exe"
      : "privacy-pools-cli-native-shell";
  return join(repoRoot, "native", "shell", "target", "release", binName);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });

  if (result.error) {
    fail(
      `Failed to execute ${command} ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    fail(
      `Command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim(),
    );
  }

  return result;
}

function packTarball(cwd, destinationDir) {
  const packResult = run(npmCommand, ["pack", "--silent"], { cwd });
  const tarballName = packResult.stdout.trim();
  const tarballSource = join(cwd, tarballName);
  const tarballDestination = join(destinationDir, tarballName);
  renameSync(tarballSource, tarballDestination);
  return tarballDestination;
}

const triplet = nativeTriplet();
const cargoCheck = triplet
  ? spawnSync(cargoCommand, ["--version"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000,
    })
  : null;

const distIndexPath = join(repoRoot, "dist", "index.js");
if (!existsSync(distIndexPath)) {
  fail("dist/index.js not found. Run `bun run build` before verifying release artifacts.");
}
const tempRoot = mkdtempSync(join(tmpdir(), "pp-release-artifacts-host-"));
const cliTarballDir = join(tempRoot, "cli");
const nativePackageDir = join(tempRoot, "native-package");

mkdirSync(cliTarballDir, { recursive: true });

try {
  const cliTarball = packTarball(repoRoot, cliTarballDir);
  run("node", [
    VERIFY_ROOT_ONLY_INSTALL,
    "--cli-tarball",
    cliTarball,
  ]);

  if (!triplet) {
    process.stdout.write(
      `Skipped native current-host artifact verification on unsupported host ${process.platform}/${process.arch}; root-only launcher path verified.\n`,
    );
  } else if (!cargoCheck || cargoCheck.error || cargoCheck.status !== 0) {
    process.stdout.write(
      `Skipped native current-host artifact verification because cargo is unavailable on ${process.platform}/${process.arch}; root-only launcher path verified.\n`,
    );
  } else {
    run(cargoCommand, [
      "build",
      "--manifest-path",
      "native/shell/Cargo.toml",
      "--release",
    ]);

    const nativePackResult = run("node", [
      join(repoRoot, "scripts", "pack-native-tarball.mjs"),
      "--triplet",
      triplet,
      "--out-dir",
      nativePackageDir,
      "--binary",
      nativeBinaryPath(),
    ]);
    const nativeTarball = nativePackResult.stdout.trim();

    run("node", [
      join(repoRoot, "scripts", "verify-release-install.mjs"),
      "--cli-tarball",
      cliTarball,
      "--native-tarball",
      nativeTarball,
    ]);
  }

  const hostLabel = triplet ?? `${process.platform}/${process.arch}`;
  process.stdout.write(
    `Verified current-host release artifacts for ${hostLabel} using ${distIndexPath}\n`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
