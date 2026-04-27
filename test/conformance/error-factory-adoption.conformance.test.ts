import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

function source(path: string): string {
  return readFileSync(join(CLI_ROOT, path), "utf8");
}

describe("error factory adoption", () => {
  test("new pools and stats input errors use branded factory helpers", () => {
    for (const path of ["src/commands/pools.ts", "src/commands/stats.ts"]) {
      const text = source(path);
      expect(text).toContain("../utils/errors/factories.js");
      expect(text).toContain("inputError(");
    }
  });
});
