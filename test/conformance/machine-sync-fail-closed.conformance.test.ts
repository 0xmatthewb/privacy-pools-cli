import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";
const balanceSource = readFileSync(`${CLI_ROOT}/src/commands/balance.ts`, "utf8");
const accountsSource = readFileSync(`${CLI_ROOT}/src/commands/accounts.ts`, "utf8");

describe("machine sync fail-closed conformance", () => {
  test("balance defaults to sync and fails closed in JSON mode on partial sync errors", () => {
    expect(balanceSource).toContain('.option("--no-sync"');
    expect(balanceSource).toContain("opts.noSync !== true");
    expect(balanceSource).toContain("syncFailures > 0 && mode.isJson");
    expect(balanceSource).toContain("Balance sync failed for");
  });

  test("accounts defaults to sync and fails closed in JSON mode on partial sync errors", () => {
    expect(accountsSource).toContain('.option("--no-sync"');
    expect(accountsSource).toContain("opts.noSync !== true");
    expect(accountsSource).toContain("syncFailures > 0 && mode.isJson");
    expect(accountsSource).toContain("Account sync failed for");
  });
});
