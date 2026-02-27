import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const LIVE_E2E = process.env.PP_E2E_ENABLED === "1";
const LIVE_E2E_REQUIRED = process.env.PP_E2E_REQUIRED === "1";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const REQUIRED_E2E_ENV_VARS = [
  "PP_E2E_CHAIN",
  "PP_E2E_MNEMONIC",
  "PP_E2E_PRIVATE_KEY",
  "PP_E2E_ASSET",
  "PP_E2E_DEPOSIT_AMOUNT",
];
const MISSING_REQUIRED_E2E_ENV_VARS = REQUIRED_E2E_ENV_VARS.filter(
  (v) => !process.env[v]?.trim()
);
const LIVE_E2E_READY = LIVE_E2E && MISSING_REQUIRED_E2E_ENV_VARS.length === 0;
const liveTest = LIVE_E2E_READY ? test : test.skip;

describe("live funded e2e (optional)", () => {
  test("fails fast when live e2e is required but disabled", () => {
    if (LIVE_E2E_REQUIRED && !LIVE_E2E) {
      throw new Error(
        "PP_E2E_REQUIRED=1 but PP_E2E_ENABLED is not set. Enable funded e2e or unset PP_E2E_REQUIRED."
      );
    }
    expect(true).toBe(true);
  });

  test("fails fast when live e2e is enabled but required env vars are missing", () => {
    if (!LIVE_E2E) {
      expect(true).toBe(true);
      return;
    }
    if (MISSING_REQUIRED_E2E_ENV_VARS.length > 0) {
      throw new Error(
        `E2E tests are enabled but missing required env vars:\n  ${MISSING_REQUIRED_E2E_ENV_VARS.join("\n  ")}\n\n`
        + "Set these before running test:release, e.g.:\n"
        + "  PP_E2E_CHAIN=sepolia PP_E2E_MNEMONIC='...' PP_E2E_PRIVATE_KEY=0x... "
        + "PP_E2E_ASSET=ETH PP_E2E_DEPOSIT_AMOUNT=0.001 bun run test:release"
      );
    }
    expect(true).toBe(true);
  });

  liveTest(
    "deposit flow succeeds on-chain with funded signer",
    () => {
      const chain = requiredEnv("PP_E2E_CHAIN");
      const mnemonic = requiredEnv("PP_E2E_MNEMONIC");
      const privateKey = requiredEnv("PP_E2E_PRIVATE_KEY");
      const asset = requiredEnv("PP_E2E_ASSET");
      const amount = requiredEnv("PP_E2E_DEPOSIT_AMOUNT");
      const rpcUrl = process.env.PP_E2E_RPC_URL;

      const home = createTempHome("pp-live-");

      const initArgs = [
        "--json",
        "init",
        "--mnemonic",
        mnemonic,
        "--private-key",
        privateKey,
        "--default-chain",
        chain,
        "--skip-circuits",
        "--yes",
      ];
      if (rpcUrl) {
        initArgs.push("--rpc-url", rpcUrl);
      }

      const init = runCli(initArgs, { home, timeoutMs: 120_000 });
      expect(init.status).toBe(0);
      expect(parseJsonOutput<{ success: boolean }>(init.stdout).success).toBe(true);

      const depositArgs = [
        "--json",
        "--chain",
        chain,
        "deposit",
        amount,
        "--asset",
        asset,
        "--yes",
      ];
      if (rpcUrl) {
        depositArgs.splice(2, 0, "--rpc-url", rpcUrl);
      }

      const deposit = runCli(depositArgs, { home, timeoutMs: 600_000 });
      expect(deposit.status).toBe(0);

      const depositJson = parseJsonOutput<{
        success: boolean;
        txHash?: string;
      }>(deposit.stdout);
      expect(depositJson.success).toBe(true);
      expect(typeof depositJson.txHash).toBe("string");

      const statusArgs = ["--json", "status"];
      const status = runCli(statusArgs, { home, timeoutMs: 60_000 });
      expect(status.status).toBe(0);
      expect(parseJsonOutput<{ configExists: boolean }>(status.stdout).configExists).toBe(true);
    },
    900_000
  );

  liveTest(
    "direct withdrawal flow succeeds when explicitly enabled",
    () => {
      if (process.env.PP_E2E_RUN_DIRECT_WITHDRAW !== "1") {
        return;
      }

      const chain = requiredEnv("PP_E2E_CHAIN");
      const mnemonic = requiredEnv("PP_E2E_MNEMONIC");
      const privateKey = requiredEnv("PP_E2E_PRIVATE_KEY");
      const asset = requiredEnv("PP_E2E_ASSET");
      const amount = requiredEnv("PP_E2E_WITHDRAW_AMOUNT");
      const rpcUrl = process.env.PP_E2E_RPC_URL;

      const signer = privateKeyToAccount(privateKey as `0x${string}`).address;
      const home = createTempHome("pp-live-withdraw-");

      const initArgs = [
        "--json",
        "init",
        "--mnemonic",
        mnemonic,
        "--private-key",
        privateKey,
        "--default-chain",
        chain,
        "--skip-circuits",
        "--yes",
      ];
      if (rpcUrl) {
        initArgs.push("--rpc-url", rpcUrl);
      }
      const init = runCli(initArgs, { home, timeoutMs: 120_000 });
      expect(init.status).toBe(0);

      const withdrawArgs = [
        "--json",
        "--chain",
        chain,
        "withdraw",
        amount,
        "--asset",
        asset,
        "--direct",
        "--to",
        signer,
        "--yes",
      ];
      if (rpcUrl) {
        withdrawArgs.splice(2, 0, "--rpc-url", rpcUrl);
      }

      const withdraw = runCli(withdrawArgs, { home, timeoutMs: 900_000 });
      expect(withdraw.status).toBe(0);

      const withdrawJson = parseJsonOutput<{ success: boolean; mode?: string }>(
        withdraw.stdout
      );
      expect(withdrawJson.success).toBe(true);
      expect(withdrawJson.mode).toBe("direct");
    },
    1_200_000
  );

  liveTest(
    "relayed withdrawal flow succeeds when explicitly enabled",
    () => {
      if (process.env.PP_E2E_RUN_RELAYED_WITHDRAW !== "1") {
        return;
      }

      const chain = requiredEnv("PP_E2E_CHAIN");
      const mnemonic = requiredEnv("PP_E2E_MNEMONIC");
      const privateKey = requiredEnv("PP_E2E_PRIVATE_KEY");
      const asset = requiredEnv("PP_E2E_ASSET");
      const depositAmount = requiredEnv("PP_E2E_DEPOSIT_AMOUNT");
      const withdrawAmount = requiredEnv("PP_E2E_WITHDRAW_AMOUNT");
      const rpcUrl = process.env.PP_E2E_RPC_URL;
      const signer = privateKeyToAccount(privateKey as `0x${string}`).address;
      const recipient = process.env.PP_E2E_RELAY_RECIPIENT ?? signer;

      const home = createTempHome("pp-live-relayed-withdraw-");

      const initArgs = [
        "--json",
        "init",
        "--mnemonic",
        mnemonic,
        "--private-key",
        privateKey,
        "--default-chain",
        chain,
        "--skip-circuits",
        "--yes",
      ];
      if (rpcUrl) {
        initArgs.push("--rpc-url", rpcUrl);
      }
      const init = runCli(initArgs, { home, timeoutMs: 120_000 });
      expect(init.status).toBe(0);

      const depositArgs = [
        "--json",
        "--chain",
        chain,
        "deposit",
        depositAmount,
        "--asset",
        asset,
        "--yes",
      ];
      if (rpcUrl) {
        depositArgs.splice(2, 0, "--rpc-url", rpcUrl);
      }
      const deposit = runCli(depositArgs, { home, timeoutMs: 600_000 });
      expect(deposit.status).toBe(0);
      expect(parseJsonOutput<{ success: boolean }>(deposit.stdout).success).toBe(true);

      const withdrawArgs = [
        "--json",
        "--chain",
        chain,
        "withdraw",
        withdrawAmount,
        "--asset",
        asset,
        "--to",
        recipient,
        "--yes",
      ];
      if (rpcUrl) {
        withdrawArgs.splice(2, 0, "--rpc-url", rpcUrl);
      }
      const withdraw = runCli(withdrawArgs, { home, timeoutMs: 1_200_000 });
      expect(withdraw.status).toBe(0);

      const withdrawJson = parseJsonOutput<{
        success: boolean;
        mode?: string;
        recipient?: string;
        feeBPS?: string;
      }>(withdraw.stdout);
      expect(withdrawJson.success).toBe(true);
      expect(withdrawJson.mode).toBe("relayed");
      expect(withdrawJson.recipient?.toLowerCase()).toBe(recipient.toLowerCase());
      expect(typeof withdrawJson.feeBPS).toBe("string");
    },
    1_500_000
  );
});
