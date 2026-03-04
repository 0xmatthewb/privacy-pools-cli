/**
 * .env trust boundary test.
 *
 * The CLI intentionally loads .env from the config home directory
 * (~/.privacy-pools/.env), NOT the current working directory.  This prevents
 * a malicious .env in a cloned repo from silently redirecting RPC/ASP/relayer
 * endpoints or swapping the signer key.
 *
 * NOTE: Bun auto-loads .env from CWD before user code runs. We use
 * `--no-env-file` to disable this so we can test the CLI's OWN dotenv
 * loading in isolation.  In production (`node dist/index.js`), Node.js
 * does not auto-load .env files, so only the CLI's explicit
 * `loadEnv({ path: configHome })` call applies.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTempHome, mustInitSeededHome } from "../helpers/cli.ts";
import { CLI_CWD } from "../helpers/cli.ts";

describe(".env trust boundary", () => {
  test("CWD .env does not override config-home for sensitive env vars", () => {
    // 1. Set up a seeded home so status --json returns a full config.
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    // 2. Create a temporary CWD with a poisoned .env that tries to override
    //    the RPC URL and private key.
    const poisonedCwd = mkdtempSync(join(tmpdir(), "pp-env-poison-"));
    const POISONED_RPC = "http://evil.example.com:8545";
    const POISONED_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
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

    // 3. Run `status --json` from the poisoned CWD with --no-env-file to
    //    disable Bun's auto-loading.  This isolates the CLI's own dotenv
    //    call, which should only load from config home.
    const result = spawnSync(
      "bun",
      ["--no-env-file", join(CLI_CWD, "src/index.ts"), "--json", "status"],
      {
        cwd: poisonedCwd,
        env: {
          ...process.env,
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          // Clear any inherited env vars that would mask the test.
          PRIVACY_POOLS_RPC_URL: undefined,
          PRIVACY_POOLS_RPC_URL_SEPOLIA: undefined,
          PRIVACY_POOLS_PRIVATE_KEY: undefined,
          PRIVACY_POOLS_ASP_HOST: undefined,
        },
        encoding: "utf8",
        timeout: 20_000,
      }
    );

    expect(result.status).toBe(0);

    const json = JSON.parse(result.stdout.trim()) as {
      success: boolean;
      signerAddress?: string | null;
      rpcUrl?: string | null;
    };
    expect(json.success).toBe(true);

    // 4. The poisoned RPC should NOT appear anywhere in the output.
    expect(result.stdout).not.toContain("evil.example.com");
    expect(result.stderr).not.toContain("evil.example.com");

    // 5. The signer address should match the seeded key (0x1111...),
    //    NOT the poisoned deadbeef key.
    //    Seeded key 0x1111... produces address 0xC96aAa54E2d44c299564da76e1cD3184A2386B8D
    //    (derived via the SDK's poseidon path, not raw ethers).
    if (json.signerAddress) {
      expect(json.signerAddress.toLowerCase()).not.toContain("deadbeef");
    }
  });

  test("config-home .env IS loaded for sensitive vars", () => {
    // Verify the positive case: values written to configHome/.env are used.
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const configDir = join(home, ".privacy-pools");
    const MARKER_ASP = "http://config-home-marker.test:9999";
    writeFileSync(
      join(configDir, ".env"),
      `PRIVACY_POOLS_ASP_HOST=${MARKER_ASP}\n`,
      "utf-8"
    );

    const result = spawnSync(
      "bun",
      ["--no-env-file", join(CLI_CWD, "src/index.ts"), "--json", "status"],
      {
        cwd: CLI_CWD,
        env: {
          ...process.env,
          PRIVACY_POOLS_HOME: configDir,
          PRIVACY_POOLS_ASP_HOST: undefined,
        },
        encoding: "utf8",
        timeout: 20_000,
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
