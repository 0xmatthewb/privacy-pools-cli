import { describe, expect, test } from "bun:test";
import { createTempHome, runCli } from "../helpers/cli.ts";

const staticCliCache = new Map<string, ReturnType<typeof runCli>>();

function runStaticCli(args: string[], timeoutMs: number = 10_000) {
  const key = JSON.stringify([args, timeoutMs]);
  const cached = staticCliCache.get(key);
  if (cached) return cached;

  const result = runCli(args, { home: createTempHome(), timeoutMs });
  staticCliCache.set(key, result);
  return result;
}

describe("CLI help and discovery", () => {
  const BANNER_SENTINEL = ",---. ,---. ,-.-.   .-.--.   ,--.-.   .-.   ,---.  .---.  .---. ,-.     .---.";

  test("root --help lists all commands", () => {
    const result = runStaticCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
    expect(result.stdout).toContain("--quiet");
    expect(result.stdout).toContain("--verbose");
    expect(result.stdout).toContain("--no-banner");
    expect(result.stdout).toContain("-c, --chain");
    expect(result.stdout).toContain("-j, --json");
    expect(result.stdout).toContain("-y, --yes");
    expect(result.stdout).toContain("Get started:");
    // Command categories now live in the welcome screen (bare invocation),
    // not in the --help footer — verify commands are listed by Commander instead
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("pools");
    expect(result.stdout).toContain("activity");
    expect(result.stdout).toContain("stats");
    expect(result.stdout).toContain("flow");
    expect(result.stdout).toContain("deposit");
    expect(result.stdout).toContain("withdraw");
    expect(result.stdout).toContain("ragequit");
    expect(result.stdout).toContain("exit");
    expect(result.stdout).toContain("accounts");
    expect(result.stdout).toContain("migrate");
    expect(result.stdout).toContain("history");
    // sync, completion, and capabilities are all visible
    expect(result.stdout).toContain("sync");
    expect(result.stdout).toContain("capabilities");
    expect(result.stdout).toContain("describe");
    expect(result.stdout).toContain("completion");
  });

  test("root --version returns semantic version", () => {
    const result = runStaticCli(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
    const lastLine = result.stdout.trim().split(/\n/g).pop();
    expect(lastLine).toMatch(/^\d+\.\d+\.\d+$/);
  });

  const COMMAND_HELP_CASES = [
    ["init", "Initialize wallet and configuration"],
    ["flow", "Run the easy-path deposit-to-withdraw workflow"],
    ["status", "Show configuration and check connection health"],
    ["pools", "List available pools and assets"],
    ["activity", "Show public activity feed"],
    ["stats", "Show public statistics"],
    ["deposit", "Deposit into a pool"],
    ["withdraw", "Withdraw from a pool"],
    ["ragequit", "Publicly withdraw funds to your deposit address"],
    ["exit", "Publicly withdraw funds to your deposit address"],
    ["accounts", "List your Pool Accounts (individual deposit lineages) with balances"],
    ["migrate", "Inspect legacy migration readiness on CLI-supported chains"],
    ["history", "Show chronological event history"],
    ["sync", "Force-sync local account state from onchain events"],
    ["capabilities", "Describe CLI capabilities for agent discovery"],
    ["describe", "Describe one command for runtime agent introspection"],
    ["completion", "Generate shell completion script"],
  ] as const;

  for (const [command, expected] of COMMAND_HELP_CASES) {
    test(`${command} --help renders command description`, () => {
      const result = runStaticCli([command, "--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(expected);
    });
  }

  test("unknown command exits non-zero", () => {
    const result = runCli(["not-a-command"], { home: createTempHome() });
    expect(result.status).toBe(2);
    expect(result.stderr.toLowerCase()).toContain("unknown command");
  });

  test("withdraw quote --help renders subcommand description", () => {
    const result = runStaticCli(["withdraw", "quote", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
    expect(result.stdout).toContain("Request relayer quote and limits");
    expect(result.stdout).toContain("--asset");
  });

  test("guide prints to stderr", () => {
    const result = runCli(["guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    // Guide outputs to stderr and includes structural sections
    expect(result.stderr).toContain("Quick Start");
    expect(result.stderr).toContain("Workflow");
    expect(result.stderr).toContain("flow ragequit");
    expect(result.stderr).toContain("--new-wallet");
    expect(result.stderr).toContain("--export-new-wallet <path>");
  });

  test("--no-banner suppresses banner during normal command execution", () => {
    const result = runCli(["--no-banner", "status"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
  });

  test("--quiet suppresses banner during normal command execution", () => {
    const result = runCli(["--quiet", "status"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
  });

  test("-q suppresses banner during normal command execution", () => {
    const result = runCli(["-q", "status"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
  });

  test("banner is shown on bare invocation, only once per session", () => {
    const home = createTempHome();
    const sessionId = `pp-cli-test-session-${Date.now()}`;

    // Bare invocation shows banner + welcome screen
    const first = runCli([], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(first.status).toBe(0);
    expect(first.stderr).toContain(BANNER_SENTINEL);
    expect(first.stderr).toContain("A compliant way to transact privately on Ethereum.");
    expect(first.stderr).toMatch(/v\d+\.\d+\.\d+/);
    expect(first.stderr).toContain("github.com/0xmatthewb/privacy-pools-cli");
    expect(first.stdout).toContain("Explore (no wallet needed)");
    expect(first.stdout).toContain("For large transactions, use privacypools.com.");
    expect(first.stdout).not.toContain("https://privacypools.com");

    // Second bare invocation in same session suppresses banner
    const second = runCli([], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain(BANNER_SENTINEL);
    expect(second.stdout).toContain("Explore (no wallet needed)");
  });

  test("--no-banner keeps the welcome screen but suppresses banner art", () => {
    const home = createTempHome();
    const sessionId = `pp-cli-test-no-banner-${Date.now()}`;

    const result = runCli(["--no-banner"], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain(BANNER_SENTINEL);
    expect(result.stdout).toContain("Explore (no wallet needed)");
  });

  test("--quiet keeps bare invocation silent", () => {
    const home = createTempHome();
    const sessionId = `pp-cli-test-quiet-${Date.now()}`;

    const result = runCli(["--quiet"], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim()).toBe("");
  });

  test("--verbose keeps the curated welcome screen on bare invocation", () => {
    const home = createTempHome();
    const sessionId = `pp-cli-test-verbose-${Date.now()}`;

    const result = runCli(["--verbose"], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Explore (no wallet needed)");
    expect(result.stderr).toContain(BANNER_SENTINEL);
  });

  test("--chain mainnet keeps the curated welcome screen on bare invocation", () => {
    const home = createTempHome();
    const sessionId = `pp-cli-test-chain-${Date.now()}`;

    const result = runCli(["--chain", "mainnet"], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Explore (no wallet needed)");
    expect(result.stderr).toContain(BANNER_SENTINEL);
  });

  test("--chain=mainnet keeps the curated welcome screen on bare invocation", () => {
    const home = createTempHome();
    const sessionId = `pp-cli-test-chain-inline-${Date.now()}`;

    const result = runCli(["--chain=mainnet"], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Explore (no wallet needed)");
    expect(result.stderr).toContain(BANNER_SENTINEL);
  });

  test("banner is not shown before commands", () => {
    const home = createTempHome();
    const sessionId = `pp-cli-test-banner-cmd-${Date.now()}`;

    const result = runCli(["status"], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain(BANNER_SENTINEL);
  });

  // --- JSON help/version envelopes ---

  test("--json --help returns JSON with mode help", () => {
    const result = runStaticCli(["--json", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.mode).toBe("help");
    expect(typeof parsed.help).toBe("string");
  });

  test("--format=json --help returns JSON with mode help", () => {
    const result = runStaticCli(["--format=json", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.mode).toBe("help");
    expect(typeof parsed.help).toBe("string");
  });

  test("-j --help returns JSON with mode help", () => {
    const result = runStaticCli(["-j", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.mode).toBe("help");
    expect(typeof parsed.help).toBe("string");
  });

  test("bundled short flags -jh return JSON help envelope", () => {
    const result = runStaticCli(["-jh"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.mode).toBe("help");
    expect(typeof parsed.help).toBe("string");
  });

  test("--json --version returns JSON with mode version", () => {
    const result = runStaticCli(["--json", "--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.mode).toBe("version");
    expect(parsed.version).toMatch(/\d+\.\d+\.\d+/);
  });

  test("--format=json --version returns JSON with mode version", () => {
    const result = runStaticCli(["--format=json", "--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.mode).toBe("version");
    expect(parsed.version).toMatch(/\d+\.\d+\.\d+/);
  });

  test("--format=json on bare invocation returns JSON help", () => {
    const result = runCli(["--format=json"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.mode).toBe("help");
    expect(typeof parsed.help).toBe("string");
  });

  test("--format=csv --help stays human-readable", () => {
    const result = runStaticCli(["--format=csv", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("privacy-pools");
    expect(result.stdout.trim().startsWith("{")).toBe(false);
  });

  test("--format=csv --version stays human-readable", () => {
    const result = runStaticCli(["--format=csv", "--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("--format=csv on bare invocation falls back to the human welcome screen", () => {
    const result = runCli(["--format=csv"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Explore (no wallet needed)");
    expect(result.stdout.trim().startsWith("{")).toBe(false);
    expect(result.stderr.trim().startsWith("{")).toBe(false);
  });

  test("command --format=csv --help stays human-readable", () => {
    const result = runCli(["status", "--format=csv", "--help"], {
      home: createTempHome(),
    });
    const combined = result.stdout + result.stderr;
    expect(result.status).toBe(0);
    expect(combined).toContain("Show configuration and check connection health");
    expect(combined.trim().startsWith("{")).toBe(false);
  });

  // --- Flag presence in command help ---

  test("deposit --help shows --dry-run and --unsigned options", () => {
    const result = runStaticCli(["deposit", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--dry-run");
    expect(combined).toContain("--unsigned");
  });

  test("withdraw --help shows --dry-run and short aliases", () => {
    const result = runStaticCli(["withdraw", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--dry-run");
    expect(combined).toContain("-a, --asset");
    expect(combined).toContain("-t, --to");
    expect(combined).toContain("-p, --from-pa");
  });

  test("ragequit --help shows --dry-run and --from-pa", () => {
    const result = runStaticCli(["ragequit", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--dry-run");
    expect(combined).toContain("--from-pa");
  });

  test("exit --help resolves alias and shows exit options", () => {
    const result = runStaticCli(["exit", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--from-pa");
    expect(combined).toContain("--dry-run");
  });

  test("status --help shows --check option", () => {
    const result = runStaticCli(["status", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--check");
    expect(combined).not.toContain("Agent unsigned");
  });

  test("accounts --help shows --details, --no-sync, --all-chains", () => {
    const result = runStaticCli(["accounts", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--all-chains");
    expect(combined).toContain("--details");
    expect(combined).toContain("--no-sync");
    expect(combined).toContain("--summary");
    expect(combined).toContain("--pending-only");
    expect(combined).not.toContain("--sync");
  });

  test("history --help shows --no-sync option", () => {
    const result = runStaticCli(["history", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("Show chronological event history");
    expect(combined).toContain("--no-sync");
  });

  test("pools --help shows read-only discovery flags", () => {
    const result = runStaticCli(["pools", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--all-chains");
    expect(combined).toContain("--search");
    expect(combined).toContain("--sort");
  });

  test("stats --help shows global and pool modes", () => {
    const result = runStaticCli(["stats", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("global");
    expect(combined).toContain("pool");
  });

  test("capabilities --help renders command description", () => {
    const result = runStaticCli(["capabilities", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("Describe CLI capabilities for agent discovery");
  });

  test("describe --help renders command description", () => {
    const result = runStaticCli(["describe", "--help"]);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("Describe one command for runtime agent introspection");
    expect(combined).toContain("<command...>");
  });
});

// ---------------------------------------------------------------------------
// Help text snapshots — baselines exact output for regression detection.
//
// To update snapshots after intentional changes:
//   bun test --update-snapshots test/integration/cli-help.integration.test.ts
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes and normalize whitespace for stable snapshots. */
function normalizeHelp(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")   // strip ANSI color codes
    .replace(/\r\n/g, "\n")            // normalize line endings
    .replace(/\s+$/gm, "");            // strip trailing whitespace per line
}

const SNAPSHOT_COMMANDS = [
  "init",
  "flow",
  "status",
  "pools",
  "activity",
  "stats",
  "deposit",
  "withdraw",
  "ragequit",
  "accounts",
  "migrate",
  "history",
  "sync",
  "guide",
  "capabilities",
  "describe",
  "completion",
] as const;

describe("CLI --help snapshots", () => {
  test("root --help snapshot", () => {
    const result = runStaticCli(["--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });

  for (const command of SNAPSHOT_COMMANDS) {
    test(`${command} --help snapshot`, () => {
      const result = runStaticCli([command, "--help"]);
      expect(result.status).toBe(0);
      expect(normalizeHelp(result.stdout)).toMatchSnapshot();
    });
  }

  test("withdraw quote --help snapshot", () => {
    const result = runStaticCli(["withdraw", "quote", "--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });

  test("stats global --help snapshot", () => {
    const result = runStaticCli(["stats", "global", "--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });

  test("stats pool --help snapshot", () => {
    const result = runStaticCli(["stats", "pool", "--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });

  test("flow start --help snapshot", () => {
    const result = runStaticCli(["flow", "start", "--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });

  test("flow watch --help snapshot", () => {
    const result = runStaticCli(["flow", "watch", "--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });

  test("flow status --help snapshot", () => {
    const result = runStaticCli(["flow", "status", "--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });

  test("flow ragequit --help snapshot", () => {
    const result = runStaticCli(["flow", "ragequit", "--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });

  test("migrate status --help snapshot", () => {
    const result = runStaticCli(["migrate", "status", "--help"]);
    expect(result.status).toBe(0);
    expect(normalizeHelp(result.stdout)).toMatchSnapshot();
  });
});
