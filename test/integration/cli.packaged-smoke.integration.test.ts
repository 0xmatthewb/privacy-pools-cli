import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  CLI_CWD,
  createTempHome,
  parseJsonOutput,
  runBuiltCli,
} from "../helpers/cli.ts";

describe("packaged CLI smoke", () => {
  test("dist binary runs in agent mode with JSON envelopes", () => {
    const build = spawnSync("npm", ["run", "-s", "build"], {
      cwd: CLI_CWD,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(build.status).toBe(0);

    const home = createTempHome("pp-cli-dist-");

    const statusResult = runBuiltCli(["--agent", "status"], {
      home,
      timeoutMs: 60_000,
    });
    expect(statusResult.status).toBe(0);
    expect(statusResult.stderr.trim()).toBe("");

    const statusJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      configExists: boolean;
    }>(statusResult.stdout);
    expect(statusJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(statusJson.success).toBe(true);
    expect(statusJson.configExists).toBe(false);

    const unknownResult = runBuiltCli(["--agent", "not-a-command"], {
      home,
      timeoutMs: 60_000,
    });
    expect(unknownResult.status).toBe(2);
    expect(unknownResult.stderr.trim()).toBe("");

    const unknownJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      error: { category: string };
    }>(unknownResult.stdout);
    expect(unknownJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(unknownJson.success).toBe(false);
    expect(unknownJson.errorCode).toBe("INPUT_ERROR");
    expect(unknownJson.error.category).toBe("INPUT");
  }, 180_000);
});
