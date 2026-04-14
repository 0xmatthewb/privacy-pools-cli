import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
let importCounter = 0;

async function importWorkflowModule() {
  importCounter += 1;
  return import(`../../src/services/workflow.ts?backup-paths=${importCounter}`);
}

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
    const originalStatSync = realFs.statSync;

    mock.module("node:fs", () => ({
      ...realFs,
      statSync: (path: Parameters<typeof realFs.statSync>[0]) => {
        if (path === backupDir) {
          throw new Error("stat denied");
        }
        return originalStatSync(path);
      },
    }));

    const { validateWorkflowWalletBackupPath } = await importWorkflowModule();

    expect(() =>
      validateWorkflowWalletBackupPath(join(backupDir, "wallet.txt")),
    ).toThrow("Could not inspect workflow wallet backup directory");
  });

  test("validateWorkflowWalletBackupPath rewraps existing-target inspection failures", async () => {
    const home = useIsolatedHome();
    const backupDir = join(home, "exports");
    mkdirSync(backupDir, { recursive: true });
    const backupFile = join(backupDir, "wallet.txt");
    writeFileSync(backupFile, "present", "utf-8");
    const realFs = await import("node:fs");
    const originalLstatSync = realFs.lstatSync;

    mock.module("node:fs", () => ({
      ...realFs,
      lstatSync: (path: Parameters<typeof realFs.lstatSync>[0]) => {
        if (path === backupFile) {
          throw new Error("lstat denied");
        }
        return originalLstatSync(path);
      },
    }));

    const { validateWorkflowWalletBackupPath } = await importWorkflowModule();

    expect(() => validateWorkflowWalletBackupPath(backupFile)).toThrow(
      "Could not inspect workflow wallet backup target",
    );
  });
});
