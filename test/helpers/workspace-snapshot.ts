import { spawnSync } from "node:child_process";
import { cpSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildChildProcessEnv } from "./child-env.ts";
import { CLI_ROOT } from "./paths.ts";
import { cleanupTrackedTempDir, createTrackedTempDir } from "./temp.ts";
import { npmBin } from "./npm-bin.ts";

const SHARED_BUILT_WORKSPACE_SNAPSHOT_ENV =
  "PP_TEST_BUILT_WORKSPACE_SNAPSHOT";

interface WorkspaceSnapshotOptions {
  build?: boolean;
  includeDist?: boolean;
  nodeModulesMode?: "symlink" | "copy";
}

function shouldReuseSharedBuiltWorkspaceSnapshot(
  options: Omit<WorkspaceSnapshotOptions, "build"> = {},
): boolean {
  const sharedSnapshotRoot =
    process.env[SHARED_BUILT_WORKSPACE_SNAPSHOT_ENV]?.trim();
  const nodeModulesMode = options.nodeModulesMode ?? "symlink";
  const includeDist = options.includeDist ?? false;

  return Boolean(sharedSnapshotRoot) && nodeModulesMode === "symlink" && !includeDist;
}

export function buildWorkspaceSnapshot(snapshotRoot: string): void {
  const build = spawnSync(npmBin(), ["run", "-s", "build"], {
    cwd: snapshotRoot,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: buildChildProcessEnv(),
  });

  if (build.status !== 0) {
    throw new Error(
      `Snapshot build failed (exit ${build.status}):\n${build.stderr}\n${build.stdout}`,
    );
  }
}

export function createWorkspaceSnapshot(
  options: WorkspaceSnapshotOptions = {},
): string {
  const snapshotRoot = createTrackedTempDir("pp-workspace-snapshot-");
  const nodeModulesMode = options.nodeModulesMode ?? "symlink";
  const includeDist = options.includeDist ?? false;

  cpSync(CLI_ROOT, snapshotRoot, {
    recursive: true,
    filter(source) {
      const relative = source.slice(CLI_ROOT.length).replace(/^[/\\]/, "");
      if (relative === "") return true;
      if (
        relative === "native/shell/target" ||
        relative.startsWith("native/shell/target/")
      ) {
        return false;
      }

      const topLevel = relative.split(/[/\\]/)[0];
      if (topLevel === "dist") {
        return includeDist;
      }

      return topLevel !== ".git" && topLevel !== "node_modules";
    },
  });

  if (nodeModulesMode === "copy") {
    cpSync(join(CLI_ROOT, "node_modules"), join(snapshotRoot, "node_modules"), {
      recursive: true,
    });
  } else {
    symlinkSync(
      join(CLI_ROOT, "node_modules"),
      join(snapshotRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
  }

  if (options.build) {
    buildWorkspaceSnapshot(snapshotRoot);
  }

  return snapshotRoot;
}

export function createBuiltWorkspaceSnapshot(
  options: Omit<WorkspaceSnapshotOptions, "build"> = {},
): string {
  const sharedSnapshotRoot =
    process.env[SHARED_BUILT_WORKSPACE_SNAPSHOT_ENV]?.trim();

  if (shouldReuseSharedBuiltWorkspaceSnapshot(options) && sharedSnapshotRoot) {
    return resolve(sharedSnapshotRoot);
  }

  return createWorkspaceSnapshot({ ...options, build: true });
}

export function cleanupWorkspaceSnapshot(
  snapshotRoot: string | null | undefined,
): void {
  if (!snapshotRoot) return;
  const sharedSnapshotRoot =
    process.env[SHARED_BUILT_WORKSPACE_SNAPSHOT_ENV]?.trim();
  if (sharedSnapshotRoot && resolve(snapshotRoot) === resolve(sharedSnapshotRoot)) {
    return;
  }
  cleanupTrackedTempDir(snapshotRoot);
}

export const workspaceSnapshotInternals = {
  shouldReuseSharedBuiltWorkspaceSnapshot,
};
