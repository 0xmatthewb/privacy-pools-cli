import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createWorkspaceSnapshot } from "../helpers/workspace-snapshot.ts";

describe("workspace snapshot", () => {
  test("excludes native rust target artifacts from copied snapshots", () => {
    const snapshotRoot = createWorkspaceSnapshot();
    expect(existsSync(join(snapshotRoot, "native", "shell", "target"))).toBe(false);
  });
});
