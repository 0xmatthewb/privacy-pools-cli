import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { ACCEPTANCE_REPLACED_TESTS } from "../../scripts/test-suite-manifest.mjs";

describe("acceptance manifest integrity", () => {
  test("every acceptance-replaced integration suite has a matching acceptance suite", () => {
    for (const integrationPath of ACCEPTANCE_REPLACED_TESTS) {
      const acceptancePath = integrationPath
        .replace("/test/integration/cli-", "/test/acceptance/")
        .replace(".integration.test.ts", ".acceptance.test.ts");

      expect(
        existsSync(resolve(process.cwd(), acceptancePath)),
        `${acceptancePath} should exist for ${integrationPath}`,
      ).toBe(true);
    }
  });
});
