import { expect } from "bun:test";
import { buildTestInitArgs, runCli } from "../helpers/cli.ts";
import {
  assertExit,
  assertJson,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
} from "./framework.ts";

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL: "http://127.0.0.1:9",
};

interface StatusJson {
  success: boolean;
  defaultChain?: string;
  selectedChain?: string;
  signerAddress?: string;
}

defineScenarioSuite("config roundtrip acceptance", [
  defineScenario("init persists default chain and status reads it back", [
    async (ctx) => {
      ctx.lastResult = runCli(buildTestInitArgs(ctx.home, { chain: "sepolia" }), {
        home: ctx.home,
        timeoutMs: 60_000,
      });
    },
    assertExit(0),
    runCliStep(["--json", "status"], { timeoutMs: 10_000, env: OFFLINE_ENV }),
    assertExit(0),
    assertJson<StatusJson>((json) => {
      expect(json.success).toBe(true);
      expect(json.defaultChain).toBe("sepolia");
      expect(json.signerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }),
  ]),
  defineScenario("chain overrides do not mutate the stored default", [
    async (ctx) => {
      ctx.lastResult = runCli(buildTestInitArgs(ctx.home, { chain: "sepolia" }), {
        home: ctx.home,
        timeoutMs: 60_000,
      });
    },
    assertExit(0),
    runCliStep(["--json", "status", "--chain", "mainnet"], {
      timeoutMs: 10_000,
      env: OFFLINE_ENV,
    }),
    assertExit(0),
    assertJson<StatusJson>((json) => {
      expect(json.success).toBe(true);
      expect(json.defaultChain).toBe("sepolia");
      expect(json.selectedChain).toBe("mainnet");
    }),
  ]),
  defineScenario("re-init overwrites the previous config", [
    async (ctx) => {
      ctx.lastResult = runCli(buildTestInitArgs(ctx.home, { chain: "sepolia" }), {
        home: ctx.home,
        timeoutMs: 60_000,
      });
    },
    assertExit(0),
    async (ctx) => {
      ctx.lastResult = runCli(
        buildTestInitArgs(ctx.home, {
          chain: "mainnet",
          privateKey:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          force: true,
        }),
        {
          home: ctx.home,
          timeoutMs: 60_000,
        },
      );
    },
    assertExit(0),
    runCliStep(["--json", "status"], { timeoutMs: 10_000, env: OFFLINE_ENV }),
    assertExit(0),
    assertJson<StatusJson>((json) => {
      expect(json.success).toBe(true);
      expect(json.defaultChain).toBe("mainnet");
    }),
  ]),
]);
