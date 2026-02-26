import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";
const balanceSource = readFileSync(`${CLI_ROOT}/src/commands/balance.ts`, "utf8");
const accountsSource = readFileSync(`${CLI_ROOT}/src/commands/accounts.ts`, "utf8");

describe("machine sync fail-closed conformance", () => {
  test("balance --sync in JSON mode fails closed on partial sync errors", () => {
    expect(balanceSource).toContain("syncFailures > 0 && isJson");
    expect(balanceSource).toContain("Balance sync failed for");
  });

  test("accounts --sync in JSON mode fails closed on partial sync errors", () => {
    expect(accountsSource).toContain("syncFailures > 0 && isJson");
    expect(accountsSource).toContain("Account sync failed for");
  });
});
