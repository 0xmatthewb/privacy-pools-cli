import { spawnSync } from "node:child_process";
import { cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { buildChildProcessEnv } from "./child-env.ts";
import { CLI_ROOT } from "./paths.ts";
import { createTrackedTempDir } from "./temp.ts";
import { npmBin } from "./npm-bin.ts";

interface WorkspaceSnapshotOptions {
  build?: boolean;
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

  cpSync(CLI_ROOT, snapshotRoot, {
    recursive: true,
    filter(source) {
      const relative = source.slice(CLI_ROOT.length).replace(/^[/\\]/, "");
      if (relative === "") return true;

      const topLevel = relative.split(/[/\\]/)[0];
      return topLevel !== ".git" && topLevel !== "node_modules" && topLevel !== "dist";
    },
  });

  symlinkSync(
    join(CLI_ROOT, "node_modules"),
    join(snapshotRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  if (options.build) {
    buildWorkspaceSnapshot(snapshotRoot);
  }

  return snapshotRoot;
}

export function createBuiltWorkspaceSnapshot(): string {
  return createWorkspaceSnapshot({ build: true });
}
