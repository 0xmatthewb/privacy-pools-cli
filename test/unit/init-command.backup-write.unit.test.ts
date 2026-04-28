import { afterEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realConfig = captureModuleExports(await import("../../src/services/config.ts"));

describe("init command backup write isolation", () => {
  afterEach(() => {
    restoreModuleImplementations([
      ["../../src/services/config.ts", realConfig],
    ]);
    cleanupTrackedTempDirs();
  });

  test("writeRecoveryBackupFile rewraps non-Error write failures with the generic writable-parent hint", async () => {
    const home = createTrackedTempDir("pp-init-helpers-non-error-");

    mock.module("../../src/services/config.ts", () => ({
      ...realConfig,
      writePrivateFileAtomic: () => {
        throw "disk unavailable";
      },
    }));

    const { writeRecoveryBackupFile } = await import(
      `../../src/commands/init.ts?backup-write-non-error=${Date.now()}`
    );

    try {
      writeRecoveryBackupFile(join(home, "recovery.txt"), "seed words");
      throw new Error("expected writeRecoveryBackupFile to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("Could not write the recovery phrase backup");
      if (error instanceof Error) {
        expect((error as { hint?: string }).hint).toBe(
          "Check that the parent directory is writable and retry.",
        );
        expect((error as { hint?: string }).hint).not.toContain("Original error:");
      }
    }
  });
});
