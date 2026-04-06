import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setupSharedAnvilFixture } from "../../scripts/anvil-shared-fixture.mjs";
import { createTrackedTempDir } from "../helpers/temp.ts";

function fakeChild(label: string) {
  return { exitCode: null, killed: false, label };
}

function deploymentFixture() {
  return {
    entrypoint: "0xentrypoint",
    ethPool: {
      poolAddress: "0xethpool",
      scope: "1",
      assetAddress: "0xethasset",
      symbol: "ETH",
      decimals: 18,
      minimumDepositAmount: "1000000000000000",
      vettingFeeBPS: "100",
      maxRelayFeeBPS: "100",
    },
    erc20Pool: {
      poolAddress: "0xerc20pool",
      scope: "2",
      assetAddress: "0xerc20asset",
      symbol: "USDC",
      decimals: 6,
      minimumDepositAmount: "1000000",
      vettingFeeBPS: "100",
      maxRelayFeeBPS: "100",
    },
  };
}

describe("shared anvil fixture", () => {
  test("revalidates circuits before launching the fixture even when a shared cache dir is provided", async () => {
    const events: string[] = [];
    const parentDir = createTrackedTempDir("pp-shared-anvil-fixture-");
    const stateRoot = join(parentDir, "state-root");
    const circuitsDir = join(parentDir, "circuits-cache");

    const fixture = await setupSharedAnvilFixture({
      baseEnv: { PP_ANVIL_SHARED_CIRCUITS_DIR: circuitsDir },
      dependencies: {
        createStateRoot: () => {
          mkdirSync(stateRoot, { recursive: true });
          return stateRoot;
        },
        deployProtocol: async () => {
          events.push("deploy");
          return deploymentFixture();
        },
        ensureSharedCircuitArtifacts: (sharedDir: string) => {
          events.push(`provision:${sharedDir}`);
          mkdirSync(sharedDir, { recursive: true });
          return {
            durationMs: 3,
            summary: "circuits ready in cache (copied=0, skipped=6)",
          };
        },
        launchAnvil: async () => {
          events.push("launch-anvil");
          return { proc: fakeChild("anvil"), url: "http://127.0.0.1:8545" };
        },
        launchTsxServer: async (_scriptPath: string, _env: object, label: string) => {
          events.push(`launch-${label}`);
          const port = label === "asp" ? 4100 : 4200;
          return {
            proc: fakeChild(label),
            port,
            url: `http://127.0.0.1:${port}`,
          };
        },
        log: () => undefined,
        rpc: async (_rpcUrl: string, method: string) => {
          events.push(`rpc:${method}`);
          return "0x1";
        },
        seedInitialAspRoot: async () => {
          events.push("seed-root");
        },
        terminateChild: async (proc: { label: string }) => {
          events.push(`terminate:${proc.label}`);
        },
      },
    });

    expect(events[0]).toBe(`provision:${circuitsDir}`);
    expect(events.indexOf(`provision:${circuitsDir}`)).toBeLessThan(
      events.indexOf("launch-anvil"),
    );
    expect(fixture.sharedCircuitsDir).toBe(circuitsDir);
    expect(fixture.circuitProvisionDurationMs).toBe(3);
    expect(existsSync(fixture.envFile)).toBe(true);

    const envPayload = JSON.parse(readFileSync(fixture.envFile, "utf8")) as {
      aspUrl: string;
      circuitsDir: string;
      relayerUrl: string;
    };
    expect(envPayload.circuitsDir).toBe(circuitsDir);
    expect(envPayload.aspUrl).toBe("http://127.0.0.1:4100");
    expect(envPayload.relayerUrl).toBe("http://127.0.0.1:4200");

    await fixture.cleanup();

    expect(events).toContain("terminate:relayer");
    expect(events).toContain("terminate:asp");
    expect(events).toContain("terminate:anvil");
    expect(existsSync(stateRoot)).toBe(false);
  });

  test("cleans up the state root when fixture launch fails after provisioning", async () => {
    const parentDir = createTrackedTempDir("pp-shared-anvil-fixture-fail-");
    const stateRoot = join(parentDir, "state-root");

    await expect(
      setupSharedAnvilFixture({
        baseEnv: { PP_ANVIL_SHARED_CIRCUITS_DIR: join(parentDir, "circuits") },
        dependencies: {
          createStateRoot: () => {
            mkdirSync(stateRoot, { recursive: true });
            return stateRoot;
          },
          ensureSharedCircuitArtifacts: () => ({
            durationMs: 1,
            summary: "cache hit",
          }),
          launchAnvil: async () => {
            throw new Error("boom");
          },
          log: () => undefined,
        },
      }),
    ).rejects.toThrow("boom");

    expect(existsSync(stateRoot)).toBe(false);
    rmSync(parentDir, { recursive: true, force: true });
  });
});
