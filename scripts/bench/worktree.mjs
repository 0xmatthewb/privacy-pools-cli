import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoNodeModules, repoRoot } from "./constants.mjs";
import { withRepoBinPath } from "./env.mjs";
import { spawnOrThrow } from "./process.mjs";

export function buildCheckout(cwd) {
  spawnOrThrow("npm", ["run", "build"], {
    cwd,
    env: withRepoBinPath(),
  });
}

function nativeShellBinaryName(platform = process.platform) {
  return platform === "win32"
    ? "privacy-pools-cli-native-shell.exe"
    : "privacy-pools-cli-native-shell";
}

export function assertNativeSupported() {
  const supported =
    (process.platform === "darwin" &&
      (process.arch === "arm64" || process.arch === "x64")) ||
    (process.platform === "linux" && process.arch === "x64") ||
    (process.platform === "win32" &&
      (process.arch === "arm64" || process.arch === "x64"));
  if (!supported) {
    throw new Error(
      `Native benchmarking is not supported on ${process.platform}/${process.arch}.`,
    );
  }
}

export function buildNativeShell(cwd) {
  spawnOrThrow(
    "cargo",
    ["build", "--manifest-path", "native/shell/Cargo.toml", "--release"],
    {
      cwd,
      env: withRepoBinPath({}, { disableNative: false }),
    },
  );
}

export function nativeShellBinaryPath(cwd) {
  return join(
    cwd,
    "native",
    "shell",
    "target",
    "release",
    nativeShellBinaryName(),
  );
}

export function createBaselineWorktree(baseRef) {
  const worktreeDir = mkdtempSync(join(tmpdir(), "pp-cli-bench-"));
  spawnOrThrow("git", ["worktree", "add", "--detach", worktreeDir, baseRef], {
    cwd: repoRoot,
    env: process.env,
  });

  if (existsSync(repoNodeModules)) {
    symlinkSync(repoNodeModules, join(worktreeDir, "node_modules"), "dir");
  }
  return worktreeDir;
}

export function cleanupBaselineWorktree(worktreeDir) {
  try {
    spawnOrThrow("git", ["worktree", "remove", "--force", worktreeDir], {
      cwd: repoRoot,
      env: process.env,
    });
  } catch {
    // Best effort cleanup only.
  }

  try {
    rmSync(worktreeDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }
}
