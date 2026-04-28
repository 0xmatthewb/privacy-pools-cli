import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("generated envelope schema parity", () => {
  test("checked-in schemas match schemas:check", () => {
    const result = spawnSync("npm", ["run", "-s", "schemas:check"], {
      cwd: CLI_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: buildChildProcessEnv(),
    });

    if (result.status !== 0) {
      throw new Error(
        `Envelope schemas are out of date. Run npm run schemas:generate.\n${result.stdout}\n${result.stderr}`,
      );
    }
    expect(result.status).toBe(0);
  });
});
