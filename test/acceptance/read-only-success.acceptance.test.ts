import { afterAll, beforeAll, expect } from "bun:test";
import {
  killFixtureServer,
  launchFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";
import {
  assertExit,
  assertJson,
  assertStderr,
  assertStderrEmpty,
  assertStdoutEmpty,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
  seedHome,
} from "./framework.ts";

let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await launchFixtureServer();
});

afterAll(async () => {
  await killFixtureServer(fixture);
});

function fixtureEnv() {
  return { PRIVACY_POOLS_ASP_HOST: fixture.url };
}

defineScenarioSuite("read-only success acceptance", [
  defineScenario("activity returns valid events payload against the fixture server", [
    (ctx) =>
      runCliStep(["--json", "--chain", "sepolia", "activity"], {
        timeoutMs: 15_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      schemaVersion: string;
      mode: string;
      chain: string;
      chainFiltered: boolean;
      events: Array<{ type: string; txHash: string | null }>;
      page: number;
      perPage: number;
      total: number | null;
      totalPages: number | null;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.mode).toBe("global-activity");
      expect(json.chain).toBe("sepolia");
      expect(json.events.length).toBeGreaterThan(0);
      expect(json.events[0]).toHaveProperty("type");
      expect(json.events[0]).toHaveProperty("txHash");
      expect(json.total).toBeNull();
      expect(json.totalPages).toBeNull();
      expect(json.chainFiltered).toBe(true);
      expect(typeof json.page).toBe("number");
      expect(typeof json.perPage).toBe("number");
    }),
  ]),
  defineScenario("stats returns valid global statistics against the fixture server", [
    (ctx) =>
      runCliStep(["--json", "stats"], {
        timeoutMs: 15_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      schemaVersion: string;
      mode: string;
      cacheTimestamp: string | null;
      allTime: {
        tvl?: string;
        totalDepositsCount?: number;
      } | null;
      last24h: Record<string, unknown> | null;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.mode).toBe("global-stats");
      expect(json.cacheTimestamp).not.toBeNull();
      expect(json.allTime).not.toBeNull();
      expect(typeof json.allTime?.totalDepositsCount).toBe("number");
      expect(typeof json.allTime?.tvl).toBe("string");
      expect(json.last24h).not.toBeNull();
    }),
  ]),
  defineScenario("pools returns a non-empty payload when ASP and RPC fixture paths succeed", [
    (ctx) =>
      runCliStep(["--json", "--chain", "sepolia", "pools"], {
        timeoutMs: 15_000,
        env: {
          ...fixtureEnv(),
          PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
        },
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      chain?: string;
      pools: Array<{
        asset?: string;
        tokenAddress?: string;
        pool?: string;
        scope?: number | string;
        minimumDeposit?: string;
        vettingFeeBPS?: string;
        maxRelayFeeBPS?: string;
      }>;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.chain).toBe("sepolia");
      expect(json.pools.length).toBeGreaterThan(0);
      expect(json.pools[0]).toMatchObject({
        asset: "ETH",
        tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        pool: "0x1234567890AbcdEF1234567890aBcdef12345678",
        scope: "12345",
        minimumDeposit: "1000000000000000",
        vettingFeeBPS: "50",
        maxRelayFeeBPS: "250",
      });
    }),
  ]),
  defineScenario("pools succeeds with an empty list when ASP is reachable but RPC reads fail", [
    (ctx) =>
      runCliStep(["--json", "--chain", "sepolia", "pools"], {
        timeoutMs: 15_000,
        env: {
          ...fixtureEnv(),
          PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
        },
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{ success: boolean; chain?: string; pools: unknown[] }>((json) => {
      expect(json.success).toBe(true);
      expect(json.chain).toBe("sepolia");
      expect(json.pools).toEqual([]);
    }),
  ]),
  defineScenario("pools detail keeps wallet-state warnings concise when RPC log methods are unavailable", [
    seedHome("sepolia"),
    (ctx) =>
      runCliStep(["--chain", "sepolia", "--rpc-url", fixture.url, "pools", "ETH"], {
        timeoutMs: 15_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("ETH Pool on sepolia");
      expect(stderr).toContain("Could not load your wallet state from onchain data right now.");
      expect(stderr).toContain("privacy-pools status --check --chain sepolia");
      expect(stderr).not.toContain("Method not found");
      expect(stderr).not.toContain("eth_getLogs");
      expect(stderr).not.toContain("viem/");
    }),
  ]),
  defineScenario("status health checks report ASP liveness against the fixture server", [
    seedHome("sepolia"),
    (ctx) =>
      runCliStep(["--json", "--rpc-url", "http://127.0.0.1:9", "status"], {
        timeoutMs: 15_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertJson<{
      success: boolean;
      aspLive: boolean;
      rpcLive: boolean;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.aspLive).toBe(true);
      expect(json.rpcLive).toBe(false);
    }),
  ]),
]);
