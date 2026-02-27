import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";
const withdrawSource = readFileSync(`${CLI_ROOT}/src/commands/withdraw.ts`, "utf8");

describe("withdraw root source conformance", () => {
  test("reads pool state root from currentRoot() (not latestRoot())", () => {
    expect(withdrawSource).toContain('name: "currentRoot"');
    expect(withdrawSource).toContain('functionName: "currentRoot"');
    expect(withdrawSource).not.toMatch(
      /address:\s*pool\.pool[\s\S]{0,200}functionName:\s*"latestRoot"/
    );
  });

  test("keeps entrypoint latestRoot() parity checks and explicit state-root parity guard", () => {
    expect(withdrawSource).toContain('address: chainConfig.entrypoint');
    expect(withdrawSource).toContain('functionName: "latestRoot"');
    expect(withdrawSource).toContain("Pool data is out of date.");
  });
});
