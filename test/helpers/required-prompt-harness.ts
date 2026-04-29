import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PREVIEW_PROMPT_INVENTORY } from "../../scripts/lib/preview-cli-catalog.mjs";
import { createSeededHome, createTempHome, runCli } from "./cli.ts";
import {
  killFixtureServer,
  launchFixtureServer,
  type FixtureServer,
} from "./fixture-server.ts";

export interface RequiredPromptHarnessResult {
  promptShown: boolean;
  chainCalls: number;
  fileWrites: string[];
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RequiredPromptHarnessCase {
  command: string;
  promptCaseId: string;
  argv: string[];
  promptPattern: RegExp;
  seededHome?: boolean;
  input?: string;
  env?: Record<string, string>;
}

const PROMPT_CASE_IDS = new Set(
  PREVIEW_PROMPT_INVENTORY.map((entry) => entry.caseId),
);

const HARNESS_CASES: Record<string, RequiredPromptHarnessCase> = {
  init: {
    command: "init",
    promptCaseId: "init-setup-mode-prompt",
    argv: ["--no-banner", "init"],
    promptPattern: /Create a new Privacy Pools account|Load an existing Privacy Pools account/,
  },
  upgrade: {
    command: "upgrade",
    promptCaseId: "upgrade-confirm-prompt",
    argv: ["--no-banner", "upgrade"],
    promptPattern: /Install update now\?|Update Available|update available/i,
    env: {
      PRIVACY_POOLS_CLI_PREVIEW_TIMING: "after-prompts",
      PP_FORCE_TTY: "1",
    },
  },
  "flow start": {
    command: "flow start",
    promptCaseId: "flow-start-interactive-prompt",
    argv: ["--no-banner", "--chain", "sepolia", "flow", "start", "0.1", "ETH"],
    promptPattern: /recipient|withdraw/i,
    seededHome: true,
  },
  deposit: {
    command: "deposit",
    promptCaseId: "deposit-asset-select-prompt",
    argv: ["--no-banner", "--chain", "sepolia", "deposit", "0.1"],
    promptPattern: /Select asset to deposit:/,
    seededHome: true,
  },
  withdraw: {
    command: "withdraw",
    promptCaseId: "withdraw-pa-select-prompt",
    argv: ["--no-banner", "--chain", "sepolia", "withdraw", "ETH"],
    promptPattern: /Pool Account|withdraw/i,
    seededHome: true,
  },
  ragequit: {
    command: "ragequit",
    promptCaseId: "ragequit-confirm",
    argv: [
      "--no-banner",
      "--chain",
      "sepolia",
      "ragequit",
      "ETH",
      "--pool-account",
      "PA-1",
    ],
    promptPattern: /ragequit|public recovery/i,
    seededHome: true,
  },
};

function listFiles(root: string): Map<string, { mtimeMs: number; size: number }> {
  const files = new Map<string, { mtimeMs: number; size: number }>();

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = statSync(absolute);
      files.set(relative(root, absolute), {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  walk(root);
  return files;
}

function changedFiles(
  before: Map<string, { mtimeMs: number; size: number }>,
  after: Map<string, { mtimeMs: number; size: number }>,
): string[] {
  const changed: string[] = [];
  for (const [path, stat] of after) {
    if (path.startsWith("cache/")) continue;
    const previous = before.get(path);
    if (!previous || previous.size !== stat.size || previous.mtimeMs !== stat.mtimeMs) {
      changed.push(path);
    }
  }
  return changed.sort();
}

function countFixtureRequests(logPath: string): number {
  try {
    return readFileSync(logPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

async function withCountingFixture<T>(
  requestLogPath: string,
  callback: (fixture: FixtureServer, baselineRequests: number) => T,
): Promise<T> {
  writeFileSync(requestLogPath, "", "utf8");
  const fixture = await launchFixtureServer({ requestLogPath });
  try {
    return callback(fixture, countFixtureRequests(requestLogPath));
  } finally {
    await killFixtureServer(fixture);
  }
}

export function requiredPromptHarnessCommands(): string[] {
  return Object.keys(HARNESS_CASES).sort();
}

export async function runWithRequiredPromptHarness(
  command: string,
): Promise<RequiredPromptHarnessResult> {
  const harnessCase = HARNESS_CASES[command];
  if (!harnessCase) {
    throw new Error(`No required prompt harness case registered for '${command}'.`);
  }
  if (!PROMPT_CASE_IDS.has(harnessCase.promptCaseId)) {
    throw new Error(
      `Prompt case '${harnessCase.promptCaseId}' is not in PREVIEW_PROMPT_INVENTORY.`,
    );
  }

  const home = harnessCase.seededHome ? createSeededHome("sepolia") : createTempHome();
  const requestLogPath = join(home, "fixture-requests.log");

  return await withCountingFixture(requestLogPath, (fixture, baselineRequests) => {
    const homeRoot = join(home, ".privacy-pools");
    const before = listFiles(homeRoot);
    const result = runCli(harnessCase.argv, {
      home,
      timeoutMs: 20_000,
      input: harnessCase.input ?? "",
      env: {
        PP_FORCE_TTY: "1",
        PRIVACY_POOLS_CLI_PREVIEW_SCENARIO: harnessCase.promptCaseId,
        PRIVACY_POOLS_ASP_HOST: fixture.url,
        PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
        PRIVACY_POOLS_RELAYER_HOST_SEPOLIA: fixture.url,
        ...harnessCase.env,
      },
    });
    const after = listFiles(homeRoot);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const chainCalls = Math.max(
      0,
      countFixtureRequests(requestLogPath) - baselineRequests,
    );

    return {
      promptShown: harnessCase.promptPattern.test(combinedOutput),
      chainCalls,
      fileWrites: changedFiles(before, after),
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  });
}
