import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import {
  CLI_CWD,
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import { createBuiltWorkspaceSnapshot } from "../helpers/workspace-snapshot.ts";

let builtSnapshotRoot: string;
let registryUrl: string;
let registryProcess: ChildProcessWithoutNullStreams;

function nodeBin(): string {
  return process.platform === "win32" ? "node.exe" : "node";
}

function createFakeGlobalInstallRoot(): {
  installRoot: string;
  globalRoot: string;
} {
  const tempRoot = createTrackedTempDir("pp-upgrade-install-");
  const globalRoot = join(tempRoot, "global", "node_modules");
  const installRoot = join(globalRoot, "privacy-pools-cli");
  mkdirSync(globalRoot, { recursive: true });
  cpSync(builtSnapshotRoot, installRoot, { recursive: true });
  return { installRoot, globalRoot };
}

function createFakeBunGlobalInstallRoot(): {
  installRoot: string;
  globalRoot: string;
} {
  const tempRoot = createTrackedTempDir("pp-upgrade-bun-global-install-");
  const globalRoot = join(tempRoot, "global", "node_modules");
  const installRoot = join(
    tempRoot,
    ".bun",
    "install",
    "global",
    "node_modules",
    "privacy-pools-cli",
  );
  mkdirSync(globalRoot, { recursive: true });
  cpSync(builtSnapshotRoot, installRoot, { recursive: true });
  return { installRoot, globalRoot };
}

function createFakeNpmShim(
  globalRoot: string,
  options: {
    installExitCode?: number;
    installStdout?: string;
    installStderr?: string;
  } = {},
): {
  path: string;
  logPath: string;
} {
  const shimDir = createTrackedTempDir("pp-fake-npm-");
  const logPath = join(shimDir, "npm-log.jsonl");
  const shimModulePath = join(shimDir, "npm-shim.mjs");
  const shimPath = join(shimDir, process.platform === "win32" ? "npm.cmd" : "npm");

  writeFileSync(
    shimModulePath,
    `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const logPath = process.env.PP_FAKE_NPM_LOG;
const globalRoot = process.env.PP_FAKE_NPM_GLOBAL_ROOT;
if (args[0] === "root" && args[1] === "-g") {
  process.stdout.write(\`\${globalRoot}\\n\`);
  process.exit(0);
}
appendFileSync(logPath, JSON.stringify(args) + "\\n", "utf8");
if (args[0] === "install" && args[1] === "-g") {
  ${options.installStdout ? `process.stdout.write(${JSON.stringify(options.installStdout + "\n")});` : ""}
  ${options.installStderr ? `process.stderr.write(${JSON.stringify(options.installStderr + "\n")});` : ""}
  process.exit(${options.installExitCode ?? 0});
}
process.stderr.write(\`unexpected fake npm args: \${args.join(" ")}\\n\`);
process.exit(64);
`,
    "utf8",
  );

  if (process.platform === "win32") {
    writeFileSync(
      shimPath,
      `@echo off\r\nnode "%~dp0\\npm-shim.mjs" %*\r\n`,
      "utf8",
    );
  } else {
    writeFileSync(
      shimPath,
      `#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec node "$DIR/npm-shim.mjs" "$@"\n`,
      { encoding: "utf8", mode: 0o755 },
    );
  }

  return { path: shimDir, logPath };
}

function readShimLog(logPath: string): string[][] {
  try {
    return readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  } catch {
    return [];
  }
}

function runInstalledCli(
  installRoot: string,
  args: string[],
  env: Record<string, string>,
) {
  return spawnSync(nodeBin(), ["dist/index.js", ...args], {
    cwd: installRoot,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 10 * 1024 * 1024,
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(createTempHome(), ".privacy-pools"),
      ...env,
    }),
  });
}

function assertSuccessStatus(result: {
  status: number | null;
  stdout?: string;
  stderr?: string;
}): void {
  if (result.status !== 0) {
    throw new Error(
      `expected exit 0, got ${result.status}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }
}

beforeAll(async () => {
  builtSnapshotRoot = createBuiltWorkspaceSnapshot();
  registryUrl = await new Promise<string>((resolve, reject) => {
    registryProcess = spawn(
      nodeBin(),
      [
        "-e",
        `const http = require("node:http");
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ version: "9.9.9" }));
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
});`,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    registryProcess.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    registryProcess.once("error", reject);
    registryProcess.once("exit", (code) => {
      reject(
        new Error(
          `fake npm registry process exited before becoming ready (code ${code ?? "null"}): ${stderr}`,
        ),
      );
    });
    registryProcess.stdout.once("data", (chunk: Buffer | string) => {
      const port = chunk.toString().trim();
      resolve(`http://127.0.0.1:${port}/latest`);
    });
  });
}, 240_000);

afterAll(async () => {
  if (!registryProcess.killed) {
    registryProcess.kill("SIGTERM");
  }
});

describe("cli upgrade", () => {
  test("source checkouts stay manual in agent mode even when an update exists", () => {
    const result = runCli(["upgrade", "--agent", "--check"], {
      home: createTempHome(),
      cwd: CLI_CWD,
      timeoutMs: 20_000,
      env: {
        PRIVACY_POOLS_NPM_REGISTRY_URL: registryUrl,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    });

    assertSuccessStatus(result);

    const json = parseJsonOutput<{
      success: boolean;
      status: string;
      performed: boolean;
      latestVersion: string;
      installContext: { kind: string; supportedAutoRun: boolean };
      command: string | null;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.status).toBe("manual");
    expect(json.performed).toBe(false);
    expect(json.latestVersion).toBe("9.9.9");
    expect(json.installContext.kind).toBe("source_checkout");
    expect(json.installContext.supportedAutoRun).toBe(false);
    expect(json.command).toBe("npm install -g privacy-pools-cli@9.9.9");
    expect(result.stderr.trim()).toBe("");
  });

  test("agent check mode stays read-only even on supported global npm installs", () => {
    const { installRoot, globalRoot } = createFakeGlobalInstallRoot();
    const fakeNpm = createFakeNpmShim(globalRoot);
    const result = runInstalledCli(installRoot, ["upgrade", "--agent", "--check"], {
      PATH: `${fakeNpm.path}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      PP_FAKE_NPM_LOG: fakeNpm.logPath,
      PP_FAKE_NPM_GLOBAL_ROOT: globalRoot,
      PRIVACY_POOLS_NPM_REGISTRY_URL: registryUrl,
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    });

    assertSuccessStatus(result);

    const json = parseJsonOutput<{
      success: boolean;
      status: string;
      performed: boolean;
      latestVersion: string;
      installContext: { kind: string; supportedAutoRun: boolean };
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.status).toBe("ready");
    expect(json.performed).toBe(false);
    expect(json.latestVersion).toBe("9.9.9");
    expect(json.installContext.kind).toBe("global_npm");
    expect(json.installContext.supportedAutoRun).toBe(true);
    expect(readShimLog(fakeNpm.logPath)).toEqual([]);
    expect(result.stderr.trim()).toBe("");
  });

  test("agent yes mode performs the npm global install for supported installs", () => {
    const { installRoot, globalRoot } = createFakeGlobalInstallRoot();
    const fakeNpm = createFakeNpmShim(globalRoot);
    const result = runInstalledCli(installRoot, ["upgrade", "--agent", "--yes"], {
      PATH: `${fakeNpm.path}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      PP_FAKE_NPM_LOG: fakeNpm.logPath,
      PP_FAKE_NPM_GLOBAL_ROOT: globalRoot,
      PRIVACY_POOLS_NPM_REGISTRY_URL: registryUrl,
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    });

    assertSuccessStatus(result);

    const json = parseJsonOutput<{
      success: boolean;
      status: string;
      performed: boolean;
      installedVersion: string | null;
      installContext: { kind: string };
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.status).toBe("upgraded");
    expect(json.performed).toBe(true);
    expect(json.installedVersion).toBe("9.9.9");
    expect(json.installContext.kind).toBe("global_npm");
    expect(readShimLog(fakeNpm.logPath)).toEqual([
      ["install", "-g", "privacy-pools-cli@9.9.9"],
    ]);
    expect(result.stderr.trim()).toBe("");
  });

  test("agent yes mode fails closed with a structured error when npm install fails", () => {
    const { installRoot, globalRoot } = createFakeGlobalInstallRoot();
    const fakeNpm = createFakeNpmShim(globalRoot, {
      installExitCode: 17,
      installStderr: "permission denied",
    });
    const result = runInstalledCli(installRoot, ["upgrade", "--agent", "--yes"], {
      PATH: `${fakeNpm.path}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      PP_FAKE_NPM_LOG: fakeNpm.logPath,
      PP_FAKE_NPM_GLOBAL_ROOT: globalRoot,
      PRIVACY_POOLS_NPM_REGISTRY_URL: registryUrl,
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    });

    expect(result.status).toBe(1);

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { hint: string; retryable: boolean };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UPGRADE_INSTALL_FAILED");
    expect(json.errorMessage).toContain("could not upgrade");
    expect(json.error.hint).toContain("permission denied");
    expect(json.error.hint).toContain("npm install -g privacy-pools-cli@9.9.9");
    expect(json.error.retryable).toBe(true);
    expect(readShimLog(fakeNpm.logPath)).toEqual([
      ["install", "-g", "privacy-pools-cli@9.9.9"],
    ]);
    expect(result.stderr.trim()).toBe("");
  });

  test("bun global installs stay manual and point users back to npm", () => {
    const { installRoot, globalRoot } = createFakeBunGlobalInstallRoot();
    const fakeNpm = createFakeNpmShim(globalRoot);
    const result = runInstalledCli(installRoot, ["upgrade", "--agent", "--check"], {
      PATH: `${fakeNpm.path}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      PP_FAKE_NPM_LOG: fakeNpm.logPath,
      PP_FAKE_NPM_GLOBAL_ROOT: globalRoot,
      PRIVACY_POOLS_NPM_REGISTRY_URL: registryUrl,
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    });

    assertSuccessStatus(result);

    const json = parseJsonOutput<{
      success: boolean;
      status: string;
      performed: boolean;
      installContext: { kind: string; supportedAutoRun: boolean; reason: string };
      command: string | null;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.status).toBe("manual");
    expect(json.performed).toBe(false);
    expect(json.installContext.kind).toBe("unknown");
    expect(json.installContext.supportedAutoRun).toBe(false);
    expect(json.installContext.reason).toContain("Bun");
    expect(json.command).toBe("npm install -g privacy-pools-cli@9.9.9");
    expect(readShimLog(fakeNpm.logPath)).toEqual([]);
    expect(result.stderr.trim()).toBe("");
  });
});
