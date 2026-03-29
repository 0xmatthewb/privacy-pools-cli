import { beforeAll, describe, expect, test } from "bun:test";
import { basename, join } from "node:path";
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

let builtWorkspaceRoot: string;

beforeAll(() => {
  builtWorkspaceRoot = createBuiltWorkspaceSnapshot();
}, 240_000);

function runBuiltBunCli(args: string[]) {
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

function runBuiltBunImportedEntrypoint(args: string[]) {
  const script = `
    import { runCliEntrypoint } from "./dist/index.js";
    await runCliEntrypoint(${JSON.stringify(args)});
  `;
  return spawnSync("bun", ["--eval", script], {
    cwd: builtWorkspaceRoot,
    encoding: "utf8",
    timeout: 20_000,
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(createTempHome(), ".privacy-pools"),
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    }),
  });
}

function runBuiltNodeEval(script: string) {
  return spawnSync("node", ["--input-type=module", "--eval", script], {
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

  test("built dist import-and-call path also rejects Bun", () => {
    const result = runBuiltBunImportedEntrypoint(["--json", "status"]);

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
    expect(json.error.retryable).toBe(false);
  });
});

describe("supported Node runtime", () => {
  test("built launcher resolves the JS worker through node even if npm_node_execpath points at bun", () => {
    const result = runBuiltNodeEval(`
      import { basename } from "node:path";
      import { launcherTestInternals } from "./dist/launcher.js";
      import {
        decodeNativeJsBridgeDescriptor,
        NATIVE_JS_BRIDGE_ENV,
      } from "./dist/runtime/current.js";

      const target = launcherTestInternals.resolveLaunchTarget(
        { version: "1.7.0" },
        ["flow", "--help"],
        {
          npm_node_execpath: ${JSON.stringify(process.platform === "win32" ? "bun.exe" : "/tmp/bun")},
        },
        {
          resolveInstalledNativeBinary: () => "/tmp/privacy-pools-native",
        },
      );
      const descriptor = decodeNativeJsBridgeDescriptor(
        String(target.env[NATIVE_JS_BRIDGE_ENV]),
      );

      process.stdout.write(
        JSON.stringify({
          targetKind: target.kind,
          workerCommandBasename: basename(descriptor.workerCommand),
          workerArgs: descriptor.workerArgs,
        }),
      );
    `);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const json = JSON.parse(result.stdout) as {
      targetKind: string;
      workerCommandBasename: string;
      workerArgs: string[];
    };

    expect(json.targetKind).toBe("native-binary");
    expect(basename(json.workerCommandBasename)).toMatch(/^node(?:\.exe)?$/i);
    expect(json.workerArgs.at(-1)).toContain("worker-main");
  });
});
