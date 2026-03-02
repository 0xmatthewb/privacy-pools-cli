import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CLI_ROOT = process.cwd();

const SAVE_STATE_COMMANDS = [
  "src/commands/deposit.ts",
  "src/commands/withdraw.ts",
  "src/commands/ragequit.ts",
  "src/commands/sync.ts",
  "src/commands/accounts.ts",
  "src/commands/balance.ts",
  "src/commands/history.ts",
] as const;

describe("critical section conformance", () => {
  test("commands that persist account state wrap saveAccount in guard/release", () => {
    for (const relPath of SAVE_STATE_COMMANDS) {
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
});
