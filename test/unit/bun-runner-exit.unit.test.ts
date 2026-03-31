import { describe, expect, test } from "bun:test";
import { shouldTreatBunExitAsSuccess } from "../../scripts/bun-runner-exit.mjs";

describe("bun runner exit normalization", () => {
  test("accepts Bun's anomalous exit when the summary reports zero failures", () => {
    expect(
      shouldTreatBunExitAsSuccess({
        status: 3,
        stdout: "bun test v1.3.11\n",
        stderr:
          "\n 26 pass\n 0 fail\n 101 expect() calls\nRan 26 tests across 1 file. [335.00ms]\n",
      }),
    ).toBe(true);
  });

  test("rejects anomalous exits when Bun did not print a clean summary", () => {
    expect(
      shouldTreatBunExitAsSuccess({
        status: 3,
        stdout: "bun test v1.3.11\n",
        stderr:
          "\ntest/unit/example.test.ts:\n(pass) example > still running cleanup\n",
      }),
    ).toBe(false);
  });

  test("rejects summaries that include failing tests", () => {
    expect(
      shouldTreatBunExitAsSuccess({
        status: 2,
        stdout: "bun test v1.3.11\n",
        stderr:
          "\n 25 pass\n 1 fail\n 101 expect() calls\nRan 26 tests across 1 file. [335.00ms]\n",
      }),
    ).toBe(false);
  });

  test("rejects zero-pass summaries even when they report zero failures", () => {
    expect(
      shouldTreatBunExitAsSuccess({
        status: 3,
        stdout: "bun test v1.3.11\n",
        stderr:
          "\n 0 pass\n 0 fail\n 0 expect() calls\nRan 0 tests across 0 files. [1.00ms]\n",
      }),
    ).toBe(false);
  });
});
