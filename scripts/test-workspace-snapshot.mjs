import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const TEST_RUN_ID = process.env.PP_TEST_RUN_ID?.trim();

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function createSharedBuiltWorkspaceSnapshot(rootDir) {
  const prefix = TEST_RUN_ID
    ? `pp-shared-built-workspace-${TEST_RUN_ID}-`
    : "pp-shared-built-workspace-";
  const snapshotRoot = mkdtempSync(join(tmpdir(), prefix));

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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      rmSync(snapshotRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch {
      // Retry a few times below before giving up.
    }

    if (!existsSync(snapshotRoot)) {
      return;
    }
  }

  // Best effort cleanup only.
}
