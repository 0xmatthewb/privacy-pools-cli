import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CLI_CWD, createTempHome, parseJsonOutput } from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";

function runUnderBun(args: string[]) {
  return spawnSync(process.execPath, [join(CLI_CWD, "src/index.ts"), ...args], {
    cwd: CLI_CWD,
    encoding: "utf8",
    timeout: 20_000,
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(createTempHome(), ".privacy-pools"),
    }),
  });
}

describe("unsupported Bun runtime boundary", () => {
  test("human mode fails fast with a Node.js remediation hint", () => {
    const result = runUnderBun(["status"]);

    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain(
      "Privacy Pools CLI supports Node.js only. Bun is not a supported runtime.",
    );
    expect(result.stderr).toContain("npm run dev -- <command>");
    expect(result.stderr).toContain("npm i -g privacy-pools-cli");
  });

  test("structured modes return a machine-readable unsupported runtime error", () => {
    const result = runUnderBun(["--json", "status"]);

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { hint?: string; retryable?: boolean };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNSUPPORTED_RUNTIME");
    expect(json.errorMessage).toContain("Node.js only");
    expect(json.error.retryable).toBe(false);
    expect(json.error.hint).toContain("npm run dev -- <command>");
  });
});
