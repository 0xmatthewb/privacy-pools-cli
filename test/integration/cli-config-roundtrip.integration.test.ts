/**
 * Config round-trip test (Stripe pattern).
 *
 * Verifies that `init` persists configuration and that subsequent
 * commands read the stored config correctly. Ensures no config
 * options are silently lost or corrupted during persistence.
 */
import { describe, expect, test } from "bun:test";
import {
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

describe("config round-trip", () => {
  test("init persists default chain and status reads it back", () => {
    const home = createTempHome();
    const init = runCli(
      [
        "--json", "init",
        "--mnemonic", "test test test test test test test test test test test junk",
        "--private-key", "0x1111111111111111111111111111111111111111111111111111111111111111",
        "--default-chain", "sepolia",
        "--skip-circuits",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );
    expect(init.status).toBe(0);

    // Status should reflect the configured default chain
    const status = runCli(["--json", "status"], { home, timeoutMs: 10_000 });
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

    for (const [home, chain] of [[home1, "sepolia"], [home2, "ethereum"]] as const) {
      runCli(
        [
          "--json", "init",
          "--mnemonic", "test test test test test test test test test test test junk",
          "--private-key", "0x1111111111111111111111111111111111111111111111111111111111111111",
          "--default-chain", chain,
          "--skip-circuits",
          "--yes",
        ],
        { home, timeoutMs: 60_000 }
      );
    }

    const s1 = parseJsonOutput<StatusJson>(
      runCli(["--json", "status"], { home: home1, timeoutMs: 10_000 }).stdout
    );
    const s2 = parseJsonOutput<StatusJson>(
      runCli(["--json", "status"], { home: home2, timeoutMs: 10_000 }).stdout
    );

    expect(s1.defaultChain).toBe("sepolia");
    expect(s2.defaultChain).toBe("ethereum");
  });

  test("--chain flag overrides stored default chain", () => {
    const home = createTempHome();
    runCli(
      [
        "--json", "init",
        "--mnemonic", "test test test test test test test test test test test junk",
        "--private-key", "0x1111111111111111111111111111111111111111111111111111111111111111",
        "--default-chain", "sepolia",
        "--skip-circuits",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );

    // Verify default is sepolia
    const s1 = parseJsonOutput<StatusJson>(
      runCli(["--json", "status"], { home, timeoutMs: 10_000 }).stdout
    );
    expect(s1.defaultChain).toBe("sepolia");

    // Override with --chain ethereum — selectedChain should reflect override
    const s2 = parseJsonOutput<StatusJson>(
      runCli(["--json", "status", "--chain", "ethereum"], { home, timeoutMs: 10_000 }).stdout
    );
    expect(s2.success).toBe(true);
    expect(s2.selectedChain).toBe("ethereum");
    // Default should still be sepolia
    expect(s2.defaultChain).toBe("sepolia");
  });

  test("re-init overwrites previous config", () => {
    const home = createTempHome();

    // First init with sepolia
    runCli(
      [
        "--json", "init",
        "--mnemonic", "test test test test test test test test test test test junk",
        "--private-key", "0x1111111111111111111111111111111111111111111111111111111111111111",
        "--default-chain", "sepolia",
        "--skip-circuits",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );

    // Re-init with ethereum (requires --force to overwrite)
    runCli(
      [
        "--json", "init",
        "--mnemonic", "test test test test test test test test test test test junk",
        "--private-key", "0x2222222222222222222222222222222222222222222222222222222222222222",
        "--default-chain", "ethereum",
        "--skip-circuits",
        "--force",
        "--yes",
      ],
      { home, timeoutMs: 60_000 }
    );

    const status = parseJsonOutput<StatusJson>(
      runCli(["--json", "status"], { home, timeoutMs: 10_000 }).stdout
    );
    expect(status.defaultChain).toBe("ethereum");
  });
});
