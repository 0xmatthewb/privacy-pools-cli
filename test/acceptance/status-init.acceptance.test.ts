import { expect } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeTestSecretFiles } from "../helpers/cli.ts";
import {
  assertExit,
  assertJson,
  assertJsonEnvelopeStep,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
  seedHome,
  writeFile,
} from "./framework.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL: "http://127.0.0.1:9",
};

defineScenarioSuite("status/init acceptance", [
  defineScenario(
    "init persists config and signer state for status",
    [
      async (ctx) => {
        const { mnemonicPath, privateKeyPath } = writeTestSecretFiles(ctx.home);
        ctx.lastResult = ctx.runCli(
          [
            "--json",
            "init",
            "--mnemonic-file",
            mnemonicPath,
            "--private-key-file",
            privateKeyPath,
            "--default-chain",
            "sepolia",
            "--yes",
          ],
          {
            timeoutMs: 60_000,
          },
        );
      },
      assertExit(0),
      assertJsonEnvelopeStep({ success: true }),
      assertJson<{ success: boolean; defaultChain: string }>((json) => {
        expect(json.success).toBe(true);
        expect(json.defaultChain).toBe("sepolia");
      }),
      runCliStep(["--json", "status", "--no-check"], {
        timeoutMs: 60_000,
      }),
      assertExit(0),
      assertJsonEnvelopeStep({ success: true }),
      assertJson<{
        success: boolean;
        defaultChain: string;
        recoveryPhraseSet: boolean;
        signerKeySet: boolean;
        signerAddress: string;
      }>((json) => {
        expect(json.success).toBe(true);
        expect(json.defaultChain).toBe("sepolia");
        expect(json.recoveryPhraseSet).toBe(true);
        expect(json.signerKeySet).toBe(true);
        expect(json.signerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }),
    ],
    { timeoutMs: 120_000 },
  ),
  defineScenario(
    "status honors chain overrides without mutating default chain",
    [
      seedHome("mainnet"),
      runCliStep(["--json", "--chain", "sepolia", "status", "--no-check"], {
        timeoutMs: 60_000,
      }),
      assertExit(0),
      assertJson<{
        success: boolean;
        defaultChain: string | null;
        selectedChain: string | null;
        rpcUrl: string | null;
      }>((json) => {
        expect(json.success).toBe(true);
        expect(json.defaultChain).toBe("mainnet");
        expect(json.selectedChain).toBe("sepolia");
        expect(typeof json.rpcUrl).toBe("string");
        expect(json.rpcUrl).toContain("sepolia");
      }),
    ],
    { timeoutMs: 120_000 },
  ),
  defineScenario("status reports invalid signer key without a false-positive signer address", [
    writeFile(
      ".privacy-pools/config.json",
      JSON.stringify({ defaultChain: "mainnet", rpcOverrides: {} }, null, 2),
    ),
    writeFile(
      ".privacy-pools/.mnemonic",
      "test test test test test test test test test test test junk",
    ),
    writeFile(".privacy-pools/.signer", "not-a-private-key"),
    runCliStep(["--json", "status", "--no-check"], {
      env: OFFLINE_ENV,
    }),
    assertExit(0),
    assertJson<{
      signerKeySet: boolean;
      signerKeyValid: boolean;
      signerAddress: string | null;
    }>((json) => {
      expect(json.signerKeySet).toBe(true);
      expect(json.signerKeyValid).toBe(false);
      expect(json.signerAddress).toBeNull();
    }),
  ]),
  defineScenario("malformed config fails with an input envelope", [
    async (ctx) => {
      mkdirSync(join(ctx.home, ".privacy-pools"), { recursive: true });
    },
    writeFile(".privacy-pools/config.json", "{invalid json"),
    runCliStep(["--json", "status"], { timeoutMs: 60_000 }),
    assertExit(2),
    assertJsonEnvelopeStep({
      success: false,
      errorCode: "INPUT_ERROR",
    }),
    assertJson<{
      error: { category: string; code: string; message: string };
    }>((json) => {
      expect(json.error.category).toBe("INPUT");
      expect(json.error.code).toBe("INPUT_ERROR");
      expect(json.error.message).toContain("Config file is not valid JSON");
    }),
  ]),
  defineScenario("accounts keeps a structured failure envelope when the ASP is unreachable", [
    seedHome("mainnet"),
    runCliStep(["--json", "--chain", "mainnet", "accounts"], {
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    }),
    assertExit(4),
    assertJsonEnvelopeStep({ success: false }),
    assertJson<{
      error: { category: string };
    }>((json) => {
      expect(json.error.category).toBe("ASP");
    }),
  ]),
]);
