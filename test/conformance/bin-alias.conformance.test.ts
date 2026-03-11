import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("cli binary aliases", () => {
  test("publishes canonical and short command names", () => {
    const pkg = JSON.parse(
      readFileSync(`${CLI_ROOT}/package.json`, "utf8")
    ) as { bin?: Record<string, string> };

    expect(pkg.bin?.["privacy-pools"]).toBe("./dist/index.js");
    expect(pkg.bin?.pp).toBeUndefined();
  });
});
