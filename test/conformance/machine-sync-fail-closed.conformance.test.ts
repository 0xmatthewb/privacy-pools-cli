import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";
const accountsSource = readFileSync(`${CLI_ROOT}/src/commands/accounts.ts`, "utf8");
const accountServiceSource = readFileSync(`${CLI_ROOT}/src/services/account.ts`, "utf8");

describe("machine sync fail-closed conformance", () => {
  test("accounts defaults to sync and delegates to syncAccountEvents", () => {
    expect(accountsSource).toContain('.option("--no-sync"');
    expect(accountsSource).toContain("syncAccountEvents");
    expect(accountsSource).toContain('errorLabel: "Account"');
  });

  test("syncAccountEvents fails closed in JSON mode on partial sync errors", () => {
    expect(accountServiceSource).toContain("syncFailures > 0 && opts.isJson");
    expect(accountServiceSource).toContain("sync failed for");
    expect(accountServiceSource).toContain("isSyncFresh");
    expect(accountServiceSource).toContain("saveSyncMeta");
  });
});
