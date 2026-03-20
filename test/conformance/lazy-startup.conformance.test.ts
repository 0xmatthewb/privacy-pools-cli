import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CLI_ROOT = process.cwd();

const HEAVY_COMMANDS = [
  "init",
  "pools",
  "activity",
  "stats",
  "status",
  "deposit",
  "withdraw",
  "ragequit",
  "accounts",
  "history",
  "sync",
  "guide",
  "capabilities",
  "describe",
  "completion",
] as const;

const SHELL_FILES = [
  "src/command-shells/init.ts",
  "src/command-shells/pools.ts",
  "src/command-shells/activity.ts",
  "src/command-shells/stats.ts",
  "src/command-shells/status.ts",
  "src/command-shells/deposit.ts",
  "src/command-shells/withdraw.ts",
  "src/command-shells/ragequit.ts",
  "src/command-shells/accounts.ts",
  "src/command-shells/history.ts",
  "src/command-shells/sync.ts",
  "src/command-shells/guide.ts",
  "src/command-shells/capabilities.ts",
  "src/command-shells/describe.ts",
  "src/command-shells/completion.ts",
] as const;

const BANNED_SHELL_IMPORT_PATTERNS = [
  /from\s+["']@0xbow\/privacy-pools-core-sdk["']/,
  /from\s+["']@inquirer\/prompts["']/,
  /from\s+["']ora["']/,
  /from\s+["']viem(?:\/accounts)?["']/,
  /from\s+["']\.\.\/services\//,
  /from\s+["']\.\.\/output\//,
  /from\s+["']\.\.\/utils\/format\.js["']/,
  /from\s+["']\.\.\/utils\/pool-accounts\.js["']/,
  /from\s+["']\.\.\/utils\/preflight\.js["']/,
  /from\s+["']\.\.\/utils\/proof-progress\.js["']/,
  /from\s+["']\.\.\/utils\/public-activity\.js["']/,
  /from\s+["']\.\.\/utils\/unsigned(?:-flows)?\.js["']/,
] as const;

function readSource(relPath: string): string {
  return readFileSync(`${CLI_ROOT}/${relPath}`, "utf8");
}

describe("lazy startup conformance", () => {
  test("entrypoint stays free of heavy startup imports", () => {
    const source = readSource("src/index.ts");

    expect(source).not.toContain("./services/account.js");
    expect(source).not.toContain('from "dotenv"');
    expect(source).toContain("installConsoleGuard");
    expect(source).toContain('await import("./static-discovery.js")');
    expect(source).toContain('await import("./cli-main.js")');
  });

  test("full cli path keeps dotenv lazy", () => {
    const source = readSource("src/cli-main.ts");

    expect(source).not.toContain('from "dotenv"');
    expect(source).toContain('await import("dotenv")');
  });

  test("static discovery stays on the slim metadata module", () => {
    const staticDiscovery = readSource("src/static-discovery.ts");
    const capabilities = readSource("src/commands/capabilities.ts");
    const describe = readSource("src/commands/describe.ts");
    const program = readSource("src/program.ts");

    expect(staticDiscovery).toContain("./utils/command-discovery-metadata.js");
    expect(staticDiscovery).not.toContain("./utils/command-metadata.js");
    expect(capabilities).toContain("../utils/command-discovery-metadata.js");
    expect(capabilities).not.toContain("../utils/command-metadata.js");
    expect(describe).toContain("../utils/command-discovery-metadata.js");
    expect(describe).not.toContain("../utils/command-metadata.js");
    expect(program).toContain("./utils/command-discovery-metadata.js");
    expect(program).not.toContain("./utils/command-metadata.js");
  });

  test("static root help stays off the full command tree", () => {
    const staticDiscovery = readSource("src/static-discovery.ts");

    expect(staticDiscovery).toContain("./utils/root-help.js");
    expect(staticDiscovery).not.toContain("./program.js");
  });

  test("root program imports heavy commands from shell modules", () => {
    const source = readSource("src/program.ts");

    for (const commandName of HEAVY_COMMANDS) {
      expect(source).toContain(`./command-shells/${commandName}.js`);
      expect(source).not.toContain(`./commands/${commandName}.js`);
    }
  });

  test("shell modules stay free of heavy runtime imports", () => {
    for (const relPath of SHELL_FILES) {
      const source = readSource(relPath);
      expect(source).toContain("createLazyAction");

      for (const pattern of BANNED_SHELL_IMPORT_PATTERNS) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  test("lazy-loaded runtime command handlers stay exported", () => {
    const expectations: Array<[string, string[]]> = [
      ["src/commands/init.ts", ["handleInitCommand"]],
      ["src/commands/pools.ts", ["handlePoolsCommand"]],
      ["src/commands/activity.ts", ["handleActivityCommand"]],
      [
        "src/commands/stats.ts",
        ["handleGlobalStatsCommand", "handlePoolStatsCommand"],
      ],
      ["src/commands/status.ts", ["handleStatusCommand"]],
      ["src/commands/deposit.ts", ["handleDepositCommand"]],
      [
        "src/commands/withdraw.ts",
        ["handleWithdrawCommand", "handleWithdrawQuoteCommand"],
      ],
      ["src/commands/ragequit.ts", ["handleRagequitCommand"]],
      ["src/commands/accounts.ts", ["handleAccountsCommand"]],
      ["src/commands/history.ts", ["handleHistoryCommand"]],
      ["src/commands/sync.ts", ["handleSyncCommand"]],
      ["src/commands/guide.ts", ["handleGuideCommand"]],
      ["src/commands/capabilities.ts", ["handleCapabilitiesCommand"]],
      ["src/commands/describe.ts", ["handleDescribeCommand"]],
      ["src/commands/completion.ts", ["handleCompletionCommand"]],
    ];

    for (const [relPath, handlerNames] of expectations) {
      const source = readSource(relPath);
      for (const handlerName of handlerNames) {
        expect(source).toContain(`export async function ${handlerName}`);
      }
    }
  });
});
