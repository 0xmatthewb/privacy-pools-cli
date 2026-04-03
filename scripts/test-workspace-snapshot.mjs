import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function createSharedBuiltWorkspaceSnapshot(rootDir) {
  const snapshotRoot = mkdtempSync(join(tmpdir(), "pp-shared-built-workspace-"));

  cpSync(rootDir, snapshotRoot, {
    recursive: true,
    filter(source) {
      const relative = source.slice(rootDir.length).replace(/^[/\\]/, "");
      if (relative === "") return true;
      if (
        relative === "native/shell/target" ||
        relative.startsWith("native/shell/target/")
      ) {
        return false;
      }

      const topLevel = relative.split(/[/\\]/)[0];
      return topLevel !== ".git" && topLevel !== "node_modules" && topLevel !== "dist";
    },
  });

  symlinkSync(
    resolve(rootDir, "node_modules"),
    join(snapshotRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const build = spawnSync(npmBin(), ["run", "-s", "build"], {
    cwd: snapshotRoot,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: buildTestRunnerEnv(),
  });

  if (build.status !== 0) {
    rmSync(snapshotRoot, { recursive: true, force: true });
    throw new Error(
      `Shared built workspace snapshot build failed (exit ${build.status}):\n${build.stderr}\n${build.stdout}`,
    );
  }

  return snapshotRoot;
}

export function cleanupSharedBuiltWorkspaceSnapshot(snapshotRoot) {
  if (!snapshotRoot) return;
  try {
    rmSync(snapshotRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  } catch {
    // Best effort cleanup only.
  }
}
