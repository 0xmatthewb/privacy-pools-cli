import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { collectTestFiles } from "../../scripts/test-file-collector.mjs";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("test file collector", () => {
  test("returns canonical repo-relative paths for explicit files", () => {
    expect(
      collectTestFiles("./test/unit/test-runner-args.unit.test.ts", CLI_ROOT),
    ).toEqual(["./test/unit/test-runner-args.unit.test.ts"]);
  });

  test("collects and sorts test files from directories", () => {
    const files = collectTestFiles("./test/unit", CLI_ROOT);
    expect(files[0]?.startsWith("./test/unit/")).toBe(true);
    expect(files).toContain("./test/unit/test-runner-args.unit.test.ts");
    expect(files).toContain("./test/unit/ci-select-jobs.unit.test.ts");

    const sorted = [...files].sort((left, right) => left.localeCompare(right));
    expect(files).toEqual(sorted);
  });

  test("accepts absolute paths relative to the repo root", () => {
    const target = join(CLI_ROOT, "test", "unit", "ci-select-jobs.unit.test.ts");
    expect(collectTestFiles(target, CLI_ROOT)).toEqual([
      "./test/unit/ci-select-jobs.unit.test.ts",
    ]);
  });
});
