/**
 * .env trust boundary test.
 *
 * The CLI intentionally loads .env from the config home directory
 * (~/.privacy-pools/.env), NOT the current working directory.  This prevents
 * a malicious .env in a cloned repo from silently redirecting RPC/ASP/relayer
 * endpoints or swapping the signer key.
 *
 * NOTE: Source-mode CLI tests now run under Node + tsx. Node does not
 * auto-load CWD .env files, so these subprocesses exercise only the CLI's
 * own `loadEnv({ path: configHome })` behavior.
 */

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createSeededHome, TEST_PRIVATE_KEY } from "../helpers/cli.ts";
import { CLI_CWD } from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";

const TSX_LOADER_PATH = join(
  CLI_CWD,
  "node_modules",
  "tsx",
  "dist",
  "loader.mjs",
);

describe(".env trust boundary", () => {
  test("CWD .env does not override config-home for sensitive env vars", () => {
    // 1. Set up a seeded home so status --json returns a full config.
    const home = createSeededHome("sepolia");

    // 2. Create a temporary CWD with a poisoned .env that tries to override
    //    the RPC URL and private key.
    const poisonedCwd = createTrackedTempDir("pp-env-poison-");
    const POISONED_RPC = "http://evil.example.com:8545";
    const POISONED_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const expectedSignerAddress = privateKeyToAccount(TEST_PRIVATE_KEY).address;
    const poisonedSignerAddress = privateKeyToAccount(
      POISONED_KEY as `0x${string}`,
    ).address;
    writeFileSync(
      join(poisonedCwd, ".env"),
      [
        `PRIVACY_POOLS_RPC_URL=${POISONED_RPC}`,
        `PRIVACY_POOLS_RPC_URL_SEPOLIA=${POISONED_RPC}`,
        `PRIVACY_POOLS_PRIVATE_KEY=${POISONED_KEY}`,
        `PRIVACY_POOLS_ASP_HOST=http://evil.example.com:9999`,
      ].join("\n"),
      "utf-8"
    );

    // 3. Run `status --json` from the poisoned CWD. Node does not auto-load
    //    CWD .env files, so the CLI should only read from config home.
    const result = spawnSync(
      process.platform === "win32" ? "node.exe" : "node",
      [
        "--import",
        TSX_LOADER_PATH,
        join(CLI_CWD, "src/index.ts"),
        "--json",
        "status",
      ],
      {
        cwd: poisonedCwd,
        env: buildChildProcessEnv({
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          // Clear any inherited env vars that would mask the test.
          PRIVACY_POOLS_RPC_URL: undefined,
          PRIVACY_POOLS_RPC_URL_SEPOLIA: undefined,
          PRIVACY_POOLS_PRIVATE_KEY: undefined,
          PRIVACY_POOLS_ASP_HOST: undefined,
        }),
        encoding: "utf8",
        timeout: 60_000,
      }
    );

    expect(result.status).toBe(0);

    const json = JSON.parse(result.stdout.trim()) as {
      success: boolean;
      signerAddress?: string | null;
      rpcUrl?: string | null;
    };
    expect(json.success).toBe(true);
    expect(json.rpcUrl).not.toBe(POISONED_RPC);
    expect(json.signerAddress).toBe(expectedSignerAddress);
    expect(json.signerAddress).not.toBe(poisonedSignerAddress);

    // 4. The poisoned RPC should NOT appear anywhere in the output.
    expect(result.stdout).not.toContain("evil.example.com");
    expect(result.stderr).not.toContain("evil.example.com");
  });

  test("config-home .env IS loaded for sensitive vars", () => {
    // Verify the positive case: values written to configHome/.env are used.
    const home = createSeededHome("sepolia");

    const configDir = join(home, ".privacy-pools");
    const MARKER_ASP = "http://config-home-marker.test:9999";
    writeFileSync(
      join(configDir, ".env"),
      `PRIVACY_POOLS_ASP_HOST=${MARKER_ASP}\n`,
      "utf-8"
    );

    const result = spawnSync(
      process.platform === "win32" ? "node.exe" : "node",
      [
        "--import",
        TSX_LOADER_PATH,
        join(CLI_CWD, "src/index.ts"),
        "--json",
        "status",
      ],
      {
        cwd: CLI_CWD,
        env: buildChildProcessEnv({
          PRIVACY_POOLS_HOME: configDir,
          PRIVACY_POOLS_ASP_HOST: undefined,
        }),
        encoding: "utf8",
        timeout: 60_000,
      }
    );

    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout.trim()) as {
      success: boolean;
      aspHost?: string;
    };
    expect(json.success).toBe(true);
    expect(json.aspHost).toBe(MARKER_ASP);
  });
});
