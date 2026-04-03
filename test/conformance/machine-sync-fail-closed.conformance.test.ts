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

  test("syncAccountEvents fails closed on partial sync errors", () => {
    expect(accountServiceSource).toContain("sync failed for");
    expect(accountServiceSource).toContain("isSyncFresh");
    expect(accountServiceSource).toContain("saveSyncMeta");
    expect(accountServiceSource).toContain("Retry with a healthy RPC before using this data.");
  });

  test("partial sync failures persist only after the fail-closed throw path", () => {
    const syncAccountEventsPos = accountServiceSource.indexOf(
      "export async function syncAccountEvents(",
    );
    const partialFailureGuard = accountServiceSource.indexOf(
      "if (errors.length > 0) {",
      syncAccountEventsPos,
    );
    const throwPos = accountServiceSource.indexOf(
      "throw new CLIError(",
      partialFailureGuard,
    );
    const saveAccountPos = accountServiceSource.indexOf(
      "saveAccount(chainId, accountService.account)",
      syncAccountEventsPos,
    );
    const saveSyncMetaPos = accountServiceSource.indexOf(
      "saveSyncMeta(chainId)",
      saveAccountPos,
    );

    expect(partialFailureGuard).toBeGreaterThan(-1);
    expect(throwPos).toBeGreaterThan(partialFailureGuard);
    expect(saveAccountPos).toBeGreaterThan(throwPos);
    expect(saveSyncMetaPos).toBeGreaterThan(saveAccountPos);
  });

  test("read-only sync flows rebuild legacy saved accounts before refresh", () => {
    expect(accountServiceSource).toContain("allowLegacyAccountRebuild");
    expect(accountServiceSource).toContain("staleAccountRefreshRequiredError");
    expect(accountServiceSource).toContain("staleAccountRefreshFailedError");
    expect(accountServiceSource).toContain("skipImmediateSync");
    expect(accountsSource).toContain("initializeAccountServiceWithState");
    expect(accountsSource).toContain("skip: opts.sync === false || skipImmediateSync");
    expect(historySource).toContain("initializeAccountServiceWithState");
    expect(historySource).toContain("skip: opts.sync === false || skipImmediateSync");
    expect(syncSource).toContain("initializeAccountServiceWithState");
    expect(syncSource).toContain("skip: skipImmediateSync");
    expect(syncSource).toContain("strictSync: true");
  });
});
