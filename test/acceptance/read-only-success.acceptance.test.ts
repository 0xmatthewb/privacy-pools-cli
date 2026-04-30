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
  assertStdout,
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
      action?: string;
      operation: string;
      chain: string;
      events: Array<{ type: string; txHash: string | null }>;
      page: number;
      perPage: number;
      total: number | null;
      totalEvents: number | null;
      totalPages: number | null;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.mode).toBe("pools");
      expect(json.action).toBe("activity");
      expect(json.operation).toBe("pools.activity");
      expect(json.chain).toBe("sepolia");
      expect(json.events.length).toBeGreaterThan(0);
      expect(json.events[0]).toHaveProperty("type");
      expect(json.events[0]).toHaveProperty("txHash");
      expect(json.total).toBe(13);
      expect(json.totalEvents).toBe(13);
      expect(json.totalPages).toBe(2);
      expect((json as { chainFiltered?: boolean }).chainFiltered).toBeUndefined();
      expect(typeof json.page).toBe("number");
      expect(typeof json.perPage).toBe("number");
    }),
  ]),
  defineScenario("activity preserves 1-based pagination and nextActions for explicit chains", [
    (ctx) =>
      runCliStep(["--json", "--chain", "sepolia", "activity", "--page", "1", "--limit", "5"], {
        timeoutMs: 15_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      page: number;
      perPage: number;
      total: number | null;
      totalEvents: number | null;
      totalPages: number | null;
      nextActions?: Array<{ options?: { page?: number; limit?: number } }>;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.page).toBe(1);
      expect(json.perPage).toBe(5);
      expect(json.total).toBe(13);
      expect(json.totalEvents).toBe(13);
      expect(json.totalPages).toBe(3);
      expect(json.nextActions?.[0]?.options?.page).toBe(2);
      expect(json.nextActions?.[0]?.options?.limit).toBe(5);
    }),
  ]),
  defineScenario("activity wide output keeps the columnar table layout", [
    (ctx) =>
      runCliStep(["--output", "wide", "--chain", "sepolia", "activity"], {
        timeoutMs: 15_000,
        env: fixtureEnv(),
      })(ctx),
    assertExit(0),
    assertStderrEmpty(),
    assertStdout((stdout) => {
      expect(stdout).toContain("Pool Address");
      expect(stdout).toContain("Chain");
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
      action?: string;
      operation: string;
      cacheTimestamp: string | null;
      allTime: {
        tvl?: string;
        totalDepositsCount?: number;
      } | null;
      last24h: Record<string, unknown> | null;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.mode).toBe("pools");
      expect(json.action).toBe("stats");
      expect(json.operation).toBe("pools.stats");
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
  defineScenario("pools reports an RPC resolution error when ASP is reachable but RPC reads fail", [
    (ctx) =>
      runCliStep(["--json", "--chain", "sepolia", "pools"], {
        timeoutMs: 15_000,
        env: {
          ...fixtureEnv(),
          PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
        },
      })(ctx),
    assertExit(3),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      errorCode: string;
      error: { category: string; code: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("RPC_POOL_RESOLUTION_FAILED");
      expect(json.error.category).toBe("RPC");
      expect(json.error.code).toBe("RPC_POOL_RESOLUTION_FAILED");
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
