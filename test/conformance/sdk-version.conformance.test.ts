import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("sdk dependency conformance", () => {
  test("pins @0xbow/privacy-pools-core-sdk to an exact version", () => {
    const pkg = JSON.parse(
      readFileSync(`${CLI_ROOT}/package.json`, "utf8")
    ) as { dependencies?: Record<string, string> };

    const declared = pkg.dependencies?.["@0xbow/privacy-pools-core-sdk"];
    expect(typeof declared).toBe("string");
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("installed SDK version matches declared exact dependency", () => {
    const pkg = JSON.parse(
      readFileSync(`${CLI_ROOT}/package.json`, "utf8")
    ) as { dependencies?: Record<string, string> };
    const sdkPkg = JSON.parse(
      readFileSync(
        `${CLI_ROOT}/node_modules/@0xbow/privacy-pools-core-sdk/package.json`,
        "utf8"
      )
    ) as { version: string };

    const declared = pkg.dependencies?.["@0xbow/privacy-pools-core-sdk"];
    expect(sdkPkg.version).toBe(declared);
  });
});
