import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildTestInitArgs, createTempHome, runCli } from "../helpers/cli.ts";

describe("init rpc override integration", () => {
  test("persists --rpc-url for explicit --default-chain", () => {
    const home = createTempHome();
    const rpcUrl = "http://127.0.0.1:8545";

    const result = runCli(
      buildTestInitArgs(home, {
        chain: "sepolia",
        rpcUrl,
      }),
      { home }
    );

    expect(result.status).toBe(0);

    const configPath = join(home, ".privacy-pools", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      defaultChain: string;
      rpcOverrides: Record<string, string>;
    };

    expect(config.defaultChain).toBe("sepolia");
    expect(config.rpcOverrides["11155111"]).toBe(rpcUrl);
  });

  test("persists --rpc-url for implicit default chain in --yes mode", () => {
    const home = createTempHome();
    const rpcUrl = "http://127.0.0.1:9545";

    const result = runCli(
      buildTestInitArgs(home, { rpcUrl }),
      { home }
    );

    expect(result.status).toBe(0);

    const configPath = join(home, ".privacy-pools", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      defaultChain: string;
      rpcOverrides: Record<string, string>;
    };

    expect(config.defaultChain).toBe("mainnet");
    expect(config.rpcOverrides["1"]).toBe(rpcUrl);
  });
});
