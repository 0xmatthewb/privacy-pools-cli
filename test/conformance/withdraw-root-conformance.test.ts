import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";
const withdrawSource = readFileSync(`${CLI_ROOT}/src/commands/withdraw.ts`, "utf8");
const poolRootsSource = readFileSync(`${CLI_ROOT}/src/services/pool-roots.ts`, "utf8");

describe("withdraw root source conformance", () => {
  test("accepts contract-known pool roots and never substitutes entrypoint latestRoot()", () => {
    expect(poolRootsSource).toContain('name: "currentRoot"');
    expect(poolRootsSource).toContain('functionName: "currentRoot"');
    expect(poolRootsSource).toContain('name: "roots"');
    expect(poolRootsSource).toContain('functionName: "roots"');
    expect(poolRootsSource).toContain('name: "ROOT_HISTORY_SIZE"');
    expect(poolRootsSource).toContain('functionName: "ROOT_HISTORY_SIZE"');
    expect(withdrawSource).not.toMatch(
      /address:\s*pool\.pool[\s\S]{0,200}functionName:\s*"latestRoot"/
    );
  });

  test("keeps entrypoint latestRoot() parity checks separate from pool-root validation", () => {
    expect(withdrawSource).toContain('address: chainConfig.entrypoint');
    expect(withdrawSource).toContain('functionName: "latestRoot"');
    expect(withdrawSource).toContain("Pool data is out of date.");
  });

  test("direct and relayed paths both fail closed when latestRoot changes after proof work begins", () => {
    expect(withdrawSource).toContain("Pool state changed after proof generation.");
    expect(withdrawSource).toContain("Pool state changed before submission.");
  });
});
