import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertInstalledPackageVersion,
  buildInstallBaseEnv,
  installCliEnv,
  isSupportedInstallNodeVersion,
  isRetriableNpmInstallFailure,
  npmProcessEnv,
  parseArgs,
  resolveCliTarballPath,
  resolveInstalledDependencyPackagePath,
  runNpmInstallWithRetry,
  unsupportedInstallNodeMessage,
} from "../../scripts/lib/install-verification.mjs";
import { createTrackedTempDir } from "../helpers/temp.ts";

function normalizeTempPath(path: string): string {
  return path.replace(/^\/private(?=\/var\/)/, "");
}

const ORIGINAL_PRIVATE_KEY = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const ORIGINAL_PP_RPC_URL = process.env.PP_RPC_URL;
const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;
const ORIGINAL_ITERM_SESSION_ID = process.env.ITERM_SESSION_ID;

describe("install verification env hygiene", () => {
  afterEach(() => {
    if (ORIGINAL_PRIVATE_KEY === undefined) {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    } else {
      process.env.PRIVACY_POOLS_PRIVATE_KEY = ORIGINAL_PRIVATE_KEY;
    }

    if (ORIGINAL_PP_RPC_URL === undefined) {
      delete process.env.PP_RPC_URL;
    } else {
      process.env.PP_RPC_URL = ORIGINAL_PP_RPC_URL;
    }

    if (ORIGINAL_PATH === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = ORIGINAL_PATH;
    }

    if (ORIGINAL_TERM_SESSION_ID === undefined) {
      delete process.env.TERM_SESSION_ID;
    } else {
      process.env.TERM_SESSION_ID = ORIGINAL_TERM_SESSION_ID;
    }

    if (ORIGINAL_ITERM_SESSION_ID === undefined) {
      delete process.env.ITERM_SESSION_ID;
    } else {
      process.env.ITERM_SESSION_ID = ORIGINAL_ITERM_SESSION_ID;
    }
  });

  test("strips privacy-pools env vars unless they are explicitly re-added", () => {
    process.env.PRIVACY_POOLS_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    process.env.PP_RPC_URL = "https://poison.invalid/rpc";
    process.env.PATH = "/usr/bin";

    const env = buildInstallBaseEnv(process.env, {
      PRIVACY_POOLS_HOME: "/tmp/privacy-pools-test-home",
    });

    expect(env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(env.PP_RPC_URL).toBeUndefined();
    expect(env.PRIVACY_POOLS_HOME).toBe("/tmp/privacy-pools-test-home");
    expect(env.PATH).toBe("/usr/bin");
  });

  test("npmProcessEnv uses the stripped install env as its base", () => {
    process.env.PRIVACY_POOLS_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    process.env.PP_RPC_URL = "https://poison.invalid/rpc";

    const env = npmProcessEnv("/tmp/privacy-pools-test-state");

    expect(env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(env.PP_RPC_URL).toBeUndefined();
    expect(env.npm_config_cache).toBe("/tmp/privacy-pools-test-state/.npm-cache");
    expect(env.npm_config_userconfig).toBe("/tmp/privacy-pools-test-state/.npmrc");
  });

  test("installCliEnv removes interactive session markers for deterministic bare welcome checks", () => {
    process.env.TERM_SESSION_ID = "interactive-term";
    process.env.ITERM_SESSION_ID = "interactive-iterm";

    const env = installCliEnv("/tmp/privacy-pools-test-home");

    expect(env.PP_NO_UPDATE_CHECK).toBe("1");
    expect(env.NO_COLOR).toBe("1");
    expect(env.PRIVACY_POOLS_HOME).toBe("/tmp/privacy-pools-test-home");
    expect(env.TERM_SESSION_ID).toBeUndefined();
    expect(env.ITERM_SESSION_ID).toBeUndefined();
  });

  test("resolveCliTarballPath prefers an explicit cli tarball argument", () => {
    const parsedArgs = parseArgs([
      "--cli-tarball",
      "./artifacts/privacy-pools-cli.tgz",
    ]);

    expect(resolveCliTarballPath(parsedArgs)).toBe(
      resolve("./artifacts/privacy-pools-cli.tgz"),
    );
  });

  test("resolveCliTarballPath falls back when no explicit cli tarball is provided", () => {
    expect(resolveCliTarballPath({}, "./fallback/privacy-pools-cli.tgz")).toBe(
      resolve("./fallback/privacy-pools-cli.tgz"),
    );
  });

  test("resolveInstalledDependencyPackagePath matches launcher-style module resolution for hoisted and nested optional packages", () => {
    const installRoot = createTrackedTempDir("pp-install-layout-");
    const rootPackagePath = join(
      installRoot,
      "node_modules",
      "privacy-pools-cli",
    );
    mkdirSync(rootPackagePath, { recursive: true });
    writeFileSync(
      join(rootPackagePath, "package.json"),
      JSON.stringify({ name: "privacy-pools-cli", version: "1.7.0" }),
      "utf8",
    );

    const hoistedNativePath = join(
      installRoot,
      "node_modules",
      "@0xmatthewb",
      "privacy-pools-cli-native-macos-arm64",
    );
    mkdirSync(hoistedNativePath, { recursive: true });
    writeFileSync(
      join(hoistedNativePath, "package.json"),
      JSON.stringify({
        name: "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
        version: "1.7.0",
      }),
      "utf8",
    );

    expect(
      normalizeTempPath(
      resolveInstalledDependencyPackagePath(
        rootPackagePath,
        "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
      ),
      ),
    ).toBe(normalizeTempPath(hoistedNativePath));

    const nestedRoot = createTrackedTempDir("pp-install-layout-nested-");
    const nestedCliPath = join(
      nestedRoot,
      "node_modules",
      "privacy-pools-cli",
    );
    const nestedNativePath = join(
      nestedCliPath,
      "node_modules",
      "@0xmatthewb",
      "privacy-pools-cli-native-macos-arm64",
    );
    mkdirSync(nestedNativePath, { recursive: true });
    writeFileSync(
      join(nestedCliPath, "package.json"),
      JSON.stringify({ name: "privacy-pools-cli", version: "1.7.0" }),
      "utf8",
    );
    writeFileSync(
      join(nestedNativePath, "package.json"),
      JSON.stringify({
        name: "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
        version: "1.7.0",
      }),
      "utf8",
    );

    expect(
      normalizeTempPath(
      resolveInstalledDependencyPackagePath(
        nestedCliPath,
        "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
      ),
      ),
    ).toBe(normalizeTempPath(nestedNativePath));
  });

  test("assertInstalledPackageVersion accepts the resolved installed version contract", () => {
    const installRoot = createTrackedTempDir("pp-install-version-");
    mkdirSync(installRoot, { recursive: true });
    writeFileSync(
      join(installRoot, "package.json"),
      JSON.stringify({ name: "privacy-pools-cli", version: "1.7.0" }),
      "utf8",
    );

    expect(
      assertInstalledPackageVersion(
        installRoot,
        "1.7.0",
        "Installed registry CLI",
      ),
    ).toMatchObject({
      name: "privacy-pools-cli",
      version: "1.7.0",
    });
  });

  test("install verification helpers recognize the supported node range", () => {
    expect(isSupportedInstallNodeVersion("v22.0.0")).toBe(true);
    expect(isSupportedInstallNodeVersion("23.1.0")).toBe(true);
    expect(isSupportedInstallNodeVersion("24.3.1")).toBe(true);
    expect(isSupportedInstallNodeVersion("25.0.0")).toBe(true);
    expect(isSupportedInstallNodeVersion("v20.20.0")).toBe(false);
    expect(isSupportedInstallNodeVersion("26.0.0")).toBe(false);
  });

  test("unsupported node message is actionable", () => {
    expect(
      unsupportedInstallNodeMessage(
        "Installed-artifact verification",
        "v20.20.0",
      ),
    ).toContain("outside the supported Node.js range");
  });

  test("runNpmInstallWithRetry retries transient npm install timeouts", () => {
    const calls: string[][] = [];
    const sleeps: number[] = [];
    const result = runNpmInstallWithRetry(
      ["install", "--silent"],
      {
        cwd: "/tmp/privacy-pools-install-check",
        env: { PATH: process.env.PATH ?? "" },
        spawnSyncImpl: (_command, args) => {
          calls.push(args);
          if (calls.length === 1) {
            return {
              status: null,
              signal: "SIGTERM",
              stdout: "",
              stderr: "",
              error: new Error("spawnSync npm ETIMEDOUT"),
            };
          }

          return {
            status: 0,
            signal: null,
            stdout: "",
            stderr: "",
            error: undefined,
          };
        },
        sleepImpl: (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(calls).toEqual([
      ["install", "--silent"],
      ["install", "--silent"],
    ]);
    expect(sleeps).toEqual([1_000]);
    expect(result.status).toBe(0);
    expect(result.error).toBeUndefined();
  });

  test("runNpmInstallWithRetry does not retry non-transient npm failures", () => {
    let calls = 0;
    const result = runNpmInstallWithRetry(
      ["install", "--silent"],
      {
        cwd: "/tmp/privacy-pools-install-check",
        env: { PATH: process.env.PATH ?? "" },
        spawnSyncImpl: () => {
          calls += 1;
          return {
            status: 1,
            signal: null,
            stdout: "",
            stderr: "npm ERR! code E404",
            error: undefined,
          };
        },
        sleepImpl: () => {
          throw new Error("sleep should not run for non-transient failures");
        },
      },
    );

    expect(calls).toBe(1);
    expect(result.status).toBe(1);
    expect(isRetriableNpmInstallFailure(result)).toBe(false);
  });

  test("runNpmInstallWithRetry retries silent abnormal npm exits", () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = runNpmInstallWithRetry(
      ["install", "--silent"],
      {
        cwd: "/tmp/privacy-pools-install-check",
        env: { PATH: process.env.PATH ?? "" },
        spawnSyncImpl: () => {
          calls += 1;
          if (calls === 1) {
            return {
              status: 196,
              signal: null,
              stdout: "",
              stderr: "",
              error: undefined,
            };
          }

          return {
            status: 0,
            signal: null,
            stdout: "",
            stderr: "",
            error: undefined,
          };
        },
        sleepImpl: (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(calls).toBe(2);
    expect(sleeps).toEqual([1_000]);
    expect(result.status).toBe(0);
    expect(isRetriableNpmInstallFailure({
      status: 196,
      signal: null,
      stdout: "",
      stderr: "",
      error: undefined,
    })).toBe(true);
  });
});
