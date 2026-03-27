import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";

function nativeTriplet(
  platform = process.platform,
  arch = process.arch,
) {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64-gnu";
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";
  if (platform === "win32" && arch === "arm64") return "win32-arm64-msvc";
  return null;
}

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
if (!triplet) {
  process.stdout.write(
    `Skipping current-host release artifact verification on unsupported host ${process.platform}/${process.arch}.\n`,
  );
  process.exit(0);
}

const cargoCheck = spawnSync(cargoCommand, ["--version"], {
  cwd: repoRoot,
  encoding: "utf8",
  timeout: 15_000,
});

if (cargoCheck.error || cargoCheck.status !== 0) {
  process.stdout.write(
    `Skipping current-host release artifact verification because cargo is unavailable on ${process.platform}/${process.arch}.\n`,
  );
  process.exit(0);
}

const distIndexPath = join(repoRoot, "dist", "index.js");
if (!existsSync(distIndexPath)) {
  fail("dist/index.js not found. Run `bun run build` before verifying release artifacts.");
}
const tempRoot = mkdtempSync(join(tmpdir(), "pp-release-artifacts-host-"));
const cliTarballDir = join(tempRoot, "cli");
const nativePackageDir = join(tempRoot, "native-package");
const nativeTarballDir = join(tempRoot, "native-tarball");

mkdirSync(cliTarballDir, { recursive: true });
mkdirSync(nativeTarballDir, { recursive: true });

try {
  run(cargoCommand, [
    "build",
    "--manifest-path",
    "native/shell/Cargo.toml",
    "--release",
  ]);

  const cliTarball = packTarball(repoRoot, cliTarballDir);

  run("node", [
    join(repoRoot, "scripts", "prepare-native-package.mjs"),
    "--triplet",
    triplet,
    "--binary",
    nativeBinaryPath(),
    "--out-dir",
    nativePackageDir,
  ]);

  const nativeTarball = packTarball(nativePackageDir, nativeTarballDir);

  run("node", [
    join(repoRoot, "scripts", "verify-packed-native-package.mjs"),
    "--triplet",
    triplet,
    "--tarball",
    nativeTarball,
  ]);

  run("node", [
    join(repoRoot, "scripts", "verify-release-install.mjs"),
    "--cli-tarball",
    cliTarball,
    "--native-tarball",
    nativeTarball,
  ]);

  process.stdout.write(
    `Verified current-host release artifacts for ${triplet} using ${distIndexPath}\n`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
