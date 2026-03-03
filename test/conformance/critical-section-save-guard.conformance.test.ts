import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CLI_ROOT = process.cwd();

// Commands that call saveAccount directly (transaction commands)
const DIRECT_SAVE_COMMANDS = [
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
  test("transaction commands that persist account state wrap saveAccount in guard/release", () => {
    for (const relPath of DIRECT_SAVE_COMMANDS) {
      const source = readFileSync(`${CLI_ROOT}/${relPath}`, "utf8");

      expect(source).toContain("guardCriticalSection");
      expect(source).toContain("releaseCriticalSection");
      expect(source).toContain("saveAccount(");

      // Count every saveAccount( call in the file
      const saveMatches = source.match(/saveAccount\(/g);
      expect(saveMatches).not.toBeNull();
      const saveCount = saveMatches!.length;

      // Count guard→save→release sequences (non-greedy to match individual triples)
      const guardedPattern =
        /guardCriticalSection\(\);[\s\S]*?saveAccount\([\s\S]*?releaseCriticalSection\(\);/g;
      const guardedMatches = source.match(guardedPattern);
      expect(guardedMatches).not.toBeNull();

      // Every saveAccount must live inside its own guarded region
      expect(guardedMatches!.length).toBe(saveCount);
    }
  });

  test("query and sync commands delegate to syncAccountEvents (which handles critical sections)", () => {
    for (const relPath of DELEGATED_SAVE_COMMANDS) {
      const source = readFileSync(`${CLI_ROOT}/${relPath}`, "utf8");
      expect(source).toContain("syncAccountEvents");
    }
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
