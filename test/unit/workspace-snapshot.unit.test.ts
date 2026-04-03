import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTrackedTempDir, createTrackedTempDir } from "../helpers/temp.ts";
import { createWorkspaceSnapshot } from "../helpers/workspace-snapshot.ts";
import {
  cleanupWorkspaceSnapshot,
  createBuiltWorkspaceSnapshot,
  workspaceSnapshotInternals,
} from "../helpers/workspace-snapshot.ts";

describe("workspace snapshot", () => {
  test("excludes native rust target artifacts from copied snapshots", () => {
    const snapshotRoot = createWorkspaceSnapshot();
    expect(existsSync(join(snapshotRoot, "native", "shell", "target"))).toBe(false);
  });

  test("reuses the shared built snapshot when the runner provides one", () => {
    const sharedSnapshotRoot = createTrackedTempDir("pp-shared-built-snapshot-");
    process.env.PP_TEST_BUILT_WORKSPACE_SNAPSHOT = sharedSnapshotRoot;

    try {
      expect(createBuiltWorkspaceSnapshot()).toBe(sharedSnapshotRoot);
      cleanupWorkspaceSnapshot(sharedSnapshotRoot);
      expect(existsSync(sharedSnapshotRoot)).toBe(true);
    } finally {
      delete process.env.PP_TEST_BUILT_WORKSPACE_SNAPSHOT;
      cleanupTrackedTempDir(sharedSnapshotRoot);
    }
  });

  test("copy-mode built snapshots stay isolated even when a shared path exists", () => {
    const sharedSnapshotRoot = createTrackedTempDir("pp-shared-built-snapshot-");
    process.env.PP_TEST_BUILT_WORKSPACE_SNAPSHOT = sharedSnapshotRoot;

    try {
      expect(
        workspaceSnapshotInternals.shouldReuseSharedBuiltWorkspaceSnapshot({
          nodeModulesMode: "copy",
        }),
      ).toBe(false);
      expect(
        workspaceSnapshotInternals.shouldReuseSharedBuiltWorkspaceSnapshot({
          includeDist: true,
        }),
      ).toBe(false);
    } finally {
      delete process.env.PP_TEST_BUILT_WORKSPACE_SNAPSHOT;
      cleanupTrackedTempDir(sharedSnapshotRoot);
    }
  });
});
