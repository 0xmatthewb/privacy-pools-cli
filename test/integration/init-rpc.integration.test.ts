import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createTempHome, runCli } from "../helpers/cli.ts";

describe("init rpc override integration", () => {
  const mnemonic = "test test test test test test test test test test test junk";
  const privateKey = "0x1111111111111111111111111111111111111111111111111111111111111111";

  test("persists --rpc-url for explicit --default-chain", () => {
    const home = createTempHome();
    const rpcUrl = "http://127.0.0.1:8545";

    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic",
        mnemonic,
        "--private-key",
        privateKey,
        "--default-chain",
        "sepolia",
        "--rpc-url",
        rpcUrl,
        "--skip-circuits",
        "--yes",
      ],
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
      [
        "--json",
        "init",
        "--mnemonic",
        mnemonic,
        "--private-key",
        privateKey,
        "--rpc-url",
        rpcUrl,
        "--skip-circuits",
        "--yes",
      ],
      { home }
    );

    expect(result.status).toBe(0);

    const configPath = join(home, ".privacy-pools", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      defaultChain: string;
      rpcOverrides: Record<string, string>;
    };

    expect(config.defaultChain).toBe("ethereum");
    expect(config.rpcOverrides["1"]).toBe(rpcUrl);
  });
});
