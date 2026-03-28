import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-workflow-backup-paths-");
  process.env.PRIVACY_POOLS_HOME = home;
  return home;
}

afterEach(() => {
  mock.restore();
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  cleanupTrackedTempDirs();
});

describe("workflow backup path helper isolation", () => {
  test("validateWorkflowWalletBackupPath rewraps parent directory inspection failures", async () => {
    const home = useIsolatedHome();
    const backupDir = join(home, "exports");
    mkdirSync(backupDir, { recursive: true });
    const realFs = await import("node:fs");

    mock.module("node:fs", () => ({
      ...realFs,
      statSync: (path: Parameters<typeof realFs.statSync>[0]) => {
        if (path === backupDir) {
          throw new Error("stat denied");
        }
        return realFs.statSync(path);
      },
    }));

    const { validateWorkflowWalletBackupPath } = await import(
      "../../src/services/workflow.ts?workflow-backup-stat-failure"
    );

    expect(() =>
      validateWorkflowWalletBackupPath(join(backupDir, "wallet.txt")),
    ).toThrow("Could not inspect workflow wallet backup directory");
  });
});
