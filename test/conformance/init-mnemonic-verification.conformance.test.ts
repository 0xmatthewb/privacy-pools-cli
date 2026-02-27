import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

const initSource = readFileSync(`${CLI_ROOT}/src/commands/init.ts`, "utf8");

describe("init mnemonic verification conformance", () => {
  test("interactive mnemonic verification does not echo expected secret words", () => {
    expect(initSource).toContain("Verify your backup by entering the requested words");
    expect(initSource).toContain("Incorrect word #");
    expect(initSource).not.toContain('Expected "');
  });
});

