import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";
const accountsSource = readFileSync(
  `${CLI_ROOT}/src/commands/accounts.ts`,
  "utf8",
);
const accountsShellSource = readFileSync(
  `${CLI_ROOT}/src/command-shells/accounts.ts`,
  "utf8",
);
const historySource = readFileSync(
  `${CLI_ROOT}/src/commands/history.ts`,
  "utf8",
);
const syncSource = readFileSync(
  `${CLI_ROOT}/src/commands/sync.ts`,
  "utf8",
);
const accountServiceSource = readFileSync(
  `${CLI_ROOT}/src/services/account.ts`,
  "utf8",
);

describe("machine sync fail-closed conformance", () => {
  test("accounts defaults to sync and delegates to syncAccountEvents", () => {
    expect(accountsShellSource).toContain('.option("--no-sync"');
    expect(accountsSource).toContain("syncAccountEvents");
    expect(accountsSource).toContain('errorLabel: "Account"');
  });

  test("syncAccountEvents fails closed in JSON mode on partial sync errors", () => {
    expect(accountServiceSource).toContain("syncFailures > 0 && opts.isJson");
    expect(accountServiceSource).toContain("sync failed for");
    expect(accountServiceSource).toContain("isSyncFresh");
    expect(accountServiceSource).toContain("saveSyncMeta");
  });

  test("partial sync failures skip saveSyncMeta to force re-sync", () => {
    // saveSyncMeta must be gated by syncFailures === 0 so that partial
    // failures in human mode don't mark stale data as fresh.
    expect(accountServiceSource).toContain("syncFailures === 0");
    // The saveSyncMeta call must be inside the syncFailures === 0 guard
    const guardPos = accountServiceSource.indexOf("syncFailures === 0");
    const savePos = accountServiceSource.indexOf("saveSyncMeta", guardPos);
    expect(guardPos).toBeGreaterThan(-1);
    expect(savePos).toBeGreaterThan(guardPos);
    // Ensure the guard is close to the save call (within the same block)
    expect(savePos - guardPos).toBeLessThan(100);
  });

  test("read-only sync flows rebuild legacy saved accounts before refresh", () => {
    expect(accountsSource).toContain("needsLegacyAccountRebuild");
    expect(accountsSource).toContain(
      "opts.sync !== false && needsLegacyAccountRebuild",
    );
    expect(historySource).toContain("needsLegacyAccountRebuild");
    expect(historySource).toContain(
      "opts.sync !== false && needsLegacyAccountRebuild",
    );
    expect(syncSource).toContain("needsLegacyAccountRebuild(chainConfig.id)");
  });
});
