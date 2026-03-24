/**
 * Config round-trip test (Stripe pattern).
 *
 * Verifies that `init` persists configuration and that subsequent
 * commands read the stored config correctly. Ensures no config
 * options are silently lost or corrupted during persistence.
 */
import { describe, expect, test } from "bun:test";
import {
  buildTestInitArgs,
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

interface StatusJson {
  success: boolean;
  defaultChain?: string;
  selectedChain?: string;
  signerAddress?: string;
  signerKeySet?: boolean;
  configExists?: boolean;
}

// Use offline ASP + RPC to make health checks fail fast (connection refused is instant).
// Without this, `status` tries real ASP + RPC health checks which add latency.
const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL: "http://127.0.0.1:9",
};

describe("config round-trip", () => {
  test("init persists default chain and status reads it back", () => {
    const home = createTempHome();
    const init = runCli(buildTestInitArgs(home, { chain: "sepolia" }), {
      home,
      timeoutMs: 60_000,
    });
    expect(init.status).toBe(0);

    // Status should reflect the configured default chain
    const status = runCli(["--json", "status"], { home, timeoutMs: 10_000, env: OFFLINE_ENV });
    expect(status.status).toBe(0);
    const json = parseJsonOutput<StatusJson>(status.stdout);
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    // Signer address derived from the deterministic private key
    expect(json.signerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("init with different chains produces different configs", () => {
    const home1 = createTempHome();
    const home2 = createTempHome();

    for (const [home, chain] of [[home1, "sepolia"], [home2, "mainnet"]] as const) {
      runCli(buildTestInitArgs(home, { chain }), { home, timeoutMs: 60_000 });
    }

    const s1 = parseJsonOutput<StatusJson>(
      runCli(["--json", "status"], { home: home1, timeoutMs: 10_000, env: OFFLINE_ENV }).stdout
    );
    const s2 = parseJsonOutput<StatusJson>(
      runCli(["--json", "status"], { home: home2, timeoutMs: 10_000, env: OFFLINE_ENV }).stdout
    );

    expect(s1.defaultChain).toBe("sepolia");
    expect(s2.defaultChain).toBe("mainnet");
  }, 30_000);

  test("--chain flag overrides stored default chain", () => {
    const home = createTempHome();
    runCli(buildTestInitArgs(home, { chain: "sepolia" }), {
      home,
      timeoutMs: 60_000,
    });

    // Verify default is sepolia
    const s1 = parseJsonOutput<StatusJson>(
      runCli(["--json", "status"], { home, timeoutMs: 10_000, env: OFFLINE_ENV }).stdout
    );
    expect(s1.defaultChain).toBe("sepolia");

    // Override with --chain mainnet — selectedChain should reflect override
    const s2 = parseJsonOutput<StatusJson>(
      runCli(["--json", "status", "--chain", "mainnet"], { home, timeoutMs: 10_000, env: OFFLINE_ENV }).stdout
    );
    expect(s2.success).toBe(true);
    expect(s2.selectedChain).toBe("mainnet");
    // Default should still be sepolia
    expect(s2.defaultChain).toBe("sepolia");
  }, 30_000);

  test("re-init overwrites previous config", () => {
    const home = createTempHome();

    // First init with sepolia
    runCli(buildTestInitArgs(home, { chain: "sepolia" }), {
      home,
      timeoutMs: 60_000,
    });

    // Re-init with mainnet (requires --force to overwrite)
    runCli(
      buildTestInitArgs(home, {
        chain: "mainnet",
        privateKey:
          "0x2222222222222222222222222222222222222222222222222222222222222222",
        force: true,
      }),
      { home, timeoutMs: 60_000 }
    );

    const status = parseJsonOutput<StatusJson>(
      runCli(["--json", "status"], { home, timeoutMs: 10_000, env: OFFLINE_ENV }).stdout
    );
    expect(status.defaultChain).toBe("mainnet");
  }, 30_000);
});
