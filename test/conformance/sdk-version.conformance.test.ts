import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

const require = createRequire(import.meta.url);

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
    const sdkPackageJsonPath = require.resolve(
      "@0xbow/privacy-pools-core-sdk/package.json"
    );
    const sdkPkg = JSON.parse(
      readFileSync(
        sdkPackageJsonPath,
        "utf8"
      )
    ) as { version: string };

    const declared = pkg.dependencies?.["@0xbow/privacy-pools-core-sdk"];
    expect(sdkPkg.version).toBe(declared);
  });
});
