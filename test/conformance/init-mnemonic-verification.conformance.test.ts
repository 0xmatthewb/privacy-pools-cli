import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

const initSource = readFileSync(`${CLI_ROOT}/src/commands/init.ts`, "utf8");

describe("init mnemonic verification conformance", () => {
  test("interactive backup confirmation exists and does not echo expected secret words", () => {
    expect(initSource).toContain("I have securely backed up my recovery phrase");
    expect(initSource).toContain("Save your recovery phrase securely");
    expect(initSource).not.toContain('Expected "');
  });
});

