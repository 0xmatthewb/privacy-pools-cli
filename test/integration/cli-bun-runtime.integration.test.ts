import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CLI_CWD, createTempHome, parseJsonOutput } from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { createBuiltWorkspaceSnapshot } from "../helpers/workspace-snapshot.ts";

function runBunCli(args: string[]) {
  return spawnSync("bun", ["src/index.ts", ...args], {
    cwd: CLI_CWD,
    encoding: "utf8",
    timeout: 20_000,
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(createTempHome(), ".privacy-pools"),
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    }),
  });
}

function runBuiltBunCli(args: string[]) {
  const builtWorkspaceRoot = createBuiltWorkspaceSnapshot();
  return spawnSync("bun", ["dist/index.js", ...args], {
    cwd: builtWorkspaceRoot,
    encoding: "utf8",
    timeout: 20_000,
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(createTempHome(), ".privacy-pools"),
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    }),
  });
}

describe("unsupported Bun runtime", () => {
  test("returns a structured INPUT error in JSON mode", () => {
    const result = runBunCli(["--json", "status"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { hint: string; retryable: boolean };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNSUPPORTED_RUNTIME");
    expect(json.errorMessage).toContain("Node.js only");
    expect(json.error.hint).toContain("npm run dev -- <command>");
    expect(json.error.retryable).toBe(false);
  });

  test("prints a concise human remediation message in text mode", () => {
    const result = runBunCli(["status"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Privacy Pools CLI supports Node.js only. Bun is not a supported runtime.",
    );
    expect(result.stderr).toContain("npm i -g privacy-pools-cli");
  });

  test("built dist entrypoint keeps the same unsupported-runtime contract under Bun", () => {
    const result = runBuiltBunCli(["--json", "status"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { hint: string; retryable: boolean };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNSUPPORTED_RUNTIME");
    expect(json.errorMessage).toContain("Node.js only");
    expect(json.error.hint).toContain("npm run dev -- <command>");
    expect(json.error.retryable).toBe(false);
  });
});
