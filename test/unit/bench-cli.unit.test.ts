import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../../scripts/bench/args.mjs";
import {
  cleanupPreparedFixtureHome,
  prepareFixtureHomeCopy,
} from "../../scripts/bench/fixture-homes.mjs";
import { COMMAND_MATRICES, getCommandMatrix } from "../../scripts/bench/matrix.mjs";

describe("bench cli helpers", () => {
  test("parseArgs keeps defaults and normalizes the legacy runtime alias", () => {
    expect(parseArgs([])).toEqual({
      baseRef: "origin/main",
      matrix: "default",
      runs: 10,
      warmup: 1,
      runtime: "js",
    });

    expect(
      parseArgs([
        "--base",
        "self",
        "--matrix",
        "readonly",
        "--runs",
        "6",
        "--warmup",
        "2",
        "--runtime",
        "launcher-native",
      ]),
    ).toEqual({
      baseRef: "self",
      matrix: "readonly",
      runs: 6,
      warmup: 2,
      runtime: "launcher-binary-override",
    });
  });

  test("parseArgs rejects unsupported matrices", () => {
    expect(() => parseArgs(["--matrix", "missing"])).toThrow(
      "--matrix must be one of: default, readonly",
    );
  });

  test("command matrices publish the expected readonly commands", () => {
    expect(Object.keys(COMMAND_MATRICES).sort()).toEqual(["default", "readonly"]);
    expect(getCommandMatrix("readonly").map((command) => command.label)).toEqual([
      "accounts --agent --chain sepolia --no-sync --summary",
      "accounts --agent --chain sepolia --no-sync --pending-only",
      "history --agent --chain sepolia --no-sync",
      "migrate status --agent --chain mainnet",
    ]);
  });

  test("fixture homes are copied to isolated temp roots", () => {
    const prepared = prepareFixtureHomeCopy("sepolia-readonly");
    try {
      const copiedAccountPath = join(
        prepared.configHome,
        "accounts",
        "11155111.json",
      );
      const original = readFileSync(copiedAccountPath, "utf8");
      writeFileSync(copiedAccountPath, `${original}\n`, "utf8");

      expect(
        readFileSync(
          join(
            process.cwd(),
            "test",
            "fixtures",
            "bench-homes",
            "sepolia-readonly",
            ".privacy-pools",
            "accounts",
            "11155111.json",
          ),
          "utf8",
        ),
      ).toBe(original);
    } finally {
      cleanupPreparedFixtureHome(prepared);
    }
  });
});
