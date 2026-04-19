import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CLI_ROOT = process.cwd();

// Fund-moving commands delegate guarded persistence through the shared
// reconciliation helper instead of open-coding guard/save/release.
const GUARDED_PERSIST_COMMANDS = [
  "src/commands/deposit.ts",
  "src/commands/withdraw.ts",
  "src/commands/ragequit.ts",
] as const;

// Commands that delegate saving to syncAccountEvents (query + sync)
const DELEGATED_SAVE_COMMANDS = [
  "src/commands/sync.ts",
  "src/commands/accounts.ts",
  "src/commands/history.ts",
] as const;

describe("critical section conformance", () => {
  test("transaction commands delegate guarded persistence to persistWithReconciliation", () => {
    for (const relPath of GUARDED_PERSIST_COMMANDS) {
      const source = readFileSync(`${CLI_ROOT}/${relPath}`, "utf8");

      expect(source).toContain("persistWithReconciliation(");
    }
  });

  test("query and sync commands delegate to syncAccountEvents (which handles critical sections)", () => {
    for (const relPath of DELEGATED_SAVE_COMMANDS) {
      const source = readFileSync(`${CLI_ROOT}/${relPath}`, "utf8");
      expect(source).toContain("syncAccountEvents");
    }
  });

  test("persistWithReconciliation wraps direct persistence in guard/release", () => {
    const source = readFileSync(
      `${CLI_ROOT}/src/services/persist-with-reconciliation.ts`,
      "utf8",
    );
    expect(source).toContain("guardCriticalSection");
    expect(source).toContain("releaseCriticalSection");
    expect(source).toContain("params.persist");

    const guardedPattern =
      /guardCriticalSection\(\);[\s\S]*?params\.persist[\s\S]*?releaseCriticalSection\(\);/g;
    const guardedMatches = source.match(guardedPattern);
    expect(guardedMatches).not.toBeNull();
  });

  test("syncAccountEvents wraps saveAccount in guard/release", () => {
    const source = readFileSync(`${CLI_ROOT}/src/services/account.ts`, "utf8");
    expect(source).toContain("guardCriticalSection");
    expect(source).toContain("releaseCriticalSection");
    expect(source).toContain("saveAccount(");

    // Verify the guarded pattern exists in syncAccountEvents
    const guardedPattern =
      /guardCriticalSection\(\);[\s\S]*?saveAccount\([\s\S]*?releaseCriticalSection\(\);/g;
    const guardedMatches = source.match(guardedPattern);
    expect(guardedMatches).not.toBeNull();
  });
});
