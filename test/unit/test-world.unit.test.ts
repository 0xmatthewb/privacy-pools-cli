import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorld } from "../helpers/test-world.ts";

const worlds: Array<ReturnType<typeof createTestWorld>> = [];

afterEach(async () => {
  while (worlds.length > 0) {
    await worlds.pop()?.teardown();
  }
});

describe("test world", () => {
  test("manages temp homes, env overrides, and cli runs", () => {
    const world = createTestWorld({ prefix: "pp-test-world-unit-" });
    worlds.push(world);

    world.setEnv({
      PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
    });
    const written = world.writeFile(".privacy-pools/example.txt", "hello");

    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, "utf8")).toBe("hello");

    const result = world.runCli(["--json", "status"], {
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(0);
    expect(world.lastResult?.stdout).toContain("\"success\":true");
  });

  test("seeds an in-process config home and restores env on teardown", async () => {
    const originalHome = process.env.PRIVACY_POOLS_HOME;
    const world = createTestWorld({ prefix: "pp-test-world-config-" });
    worlds.push(world);

    const configHome = world.seedConfigHome({
      defaultChain: "sepolia",
      withSigner: true,
    });

    expect(configHome).toBe(join(world.home, ".privacy-pools"));
    expect(process.env.PRIVACY_POOLS_HOME).toBe(configHome);
    expect(
      existsSync(join(configHome, "config.json")),
      "config.json should be written under the config home",
    ).toBe(true);
    expect(readFileSync(join(configHome, "config.json"), "utf8")).toContain(
      "\"defaultChain\": \"sepolia\"",
    );
    expect(existsSync(join(configHome, ".mnemonic"))).toBe(true);
    expect(existsSync(join(configHome, ".signer"))).toBe(true);

    await world.teardown();
    worlds.pop();

    expect(process.env.PRIVACY_POOLS_HOME).toBe(originalHome);
    expect(existsSync(world.home)).toBe(false);
  });
});
