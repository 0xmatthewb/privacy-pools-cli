import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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
});
