import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  TEST_MNEMONIC,
  TEST_PRIVATE_KEY,
  createTempHome,
  parseJsonOutput,
  runCli,
  writeTestSecretFiles,
} from "../helpers/cli.ts";
import {
  killFixtureServer,
  launchFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";

let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await launchFixtureServer();
});

afterAll(async () => {
  await killFixtureServer(fixture);
});

function fixtureEnv() {
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
  };
}

describe("agent-focused improvements", () => {
  test("describe --json returns a detailed descriptor for spaced subcommands", () => {
    const result = runCli(["--json", "describe", "withdraw", "quote"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      command: string;
      usage: string;
      flags: string[];
      globalFlags: string[];
      requiresInit: boolean;
      expectedLatencyClass: string;
      sideEffectClass: string;
      touchesFunds: boolean;
      requiresHumanReview: boolean;
      preferredSafeVariant?: { command: string; reason: string };
    }>(result.stdout);
    expect(json.command).toBe("withdraw quote");
    expect(json.usage).toBe("withdraw quote <amount> [asset]");
    expect(json.flags).toContain("--to <address>");
    expect(json.globalFlags).toContain("--agent");
    expect(json.requiresInit).toBe(true);
    expect(json.expectedLatencyClass).toBe("medium");
    expect(json.sideEffectClass).toBe("read_only");
    expect(json.touchesFunds).toBe(false);
    expect(json.requiresHumanReview).toBe(false);
    expect(result.stderr.trim()).toBe("");
  });

  test("describe accepts global flags after the command path", () => {
    const result = runCli(["describe", "stats", "global", "--agent"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      command: string;
      usage: string;
      expectedLatencyClass: string;
    }>(result.stdout);
    expect(json.command).toBe("stats global");
    expect(json.usage).toBe("stats global");
    expect(json.expectedLatencyClass).toBe("medium");
    expect(json.globalFlags).not.toContain("-c, --chain <name>");
    expect(result.stderr.trim()).toBe("");
  });

  test("describe in human mode writes summary to stderr only", () => {
    const result = runCli(["describe", "stats", "global"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("Command: stats global");
    expect(result.stderr).toContain("Usage: privacy-pools stats global");
  });

  test("describe unknown command path returns INPUT error with valid paths", () => {
    const result = runCli(["--json", "describe", "not-a-command"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      error: { category: string; message: string; hint: string };
    }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Unknown command path");
    expect(json.error.hint).toContain("withdraw quote");
    expect(json.error.hint).toContain("stats global");
  });

  test("capabilities --json exposes commandDetails and concrete stats subcommands", () => {
    const result = runCli(["--json", "capabilities"], { home: createTempHome() });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      commands: Array<{ name: string }>;
      commandDetails: Record<string, {
        command: string;
        execution: { owner: string; nativeModes: string[] };
        flags: string[];
        globalFlags: string[];
        safeReadOnly: boolean;
        sideEffectClass: string;
        touchesFunds: boolean;
        requiresHumanReview: boolean;
        preferredSafeVariant?: { command: string; reason: string };
      }>;
      executionRoutes: Record<string, { owner: string; nativeModes: string[] }>;
      safeReadOnlyCommands: string[];
    }>(result.stdout);
    expect(json.commands.map((command) => command.name)).toContain("stats global");
    expect(json.commands.map((command) => command.name)).toContain("stats pool");
    expect(json.commands.map((command) => command.name)).toContain("describe");
    expect(json.commandDetails["accounts"]?.flags).toContain("--summary");
    expect(json.commandDetails["describe"]?.command).toBe("describe");
    expect(json.commandDetails["stats global"]?.globalFlags).not.toContain("-c, --chain <name>");
    expect(json.commandDetails["guide"]?.globalFlags).toContain("--format <format>");
    expect(json.commandDetails["capabilities"]?.globalFlags).toContain("--format <format>");
    expect(json.commandDetails["status"]?.execution.owner).toBe("js-runtime");
    expect(json.commandDetails["capabilities"]?.execution.owner).toBe("native-shell");
    expect(json.executionRoutes["stats pool"]?.owner).toBe("hybrid");
    expect(json.commandDetails["withdraw"]?.sideEffectClass).toBe("fund_movement");
    expect(json.commandDetails["withdraw"]?.touchesFunds).toBe(true);
    expect(json.commandDetails["withdraw"]?.requiresHumanReview).toBe(true);
    expect(json.commandDetails["withdraw"]?.preferredSafeVariant?.command).toBe("withdraw quote");
    expect(json.commandDetails["status"]?.sideEffectClass).toBe("read_only");
    expect(json.commandDetails["guide"]?.safeReadOnly).toBe(true);
    expect(json.commandDetails["completion"]?.safeReadOnly).toBe(true);
    expect(json.safeReadOnlyCommands).toContain("guide");
    expect(json.safeReadOnlyCommands).toContain("completion");
  });

  test("capabilities accepts unrelated root flags without changing payload shape", () => {
    const result = runCli(["capabilities", "--agent", "--chain", "mainnet"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      commands: Array<{ name: string }>;
      commandDetails: Record<string, { command: string }>;
    }>(result.stdout);
    expect(json.commands.map((command) => command.name)).toContain("describe");
    expect(json.commandDetails["capabilities"]?.command).toBe("capabilities");
    expect(result.stderr.trim()).toBe("");
  });

  test("guide accepts unrelated root flags without changing payload shape", () => {
    const result = runCli(["guide", "--agent", "--chain", "mainnet"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      mode: string;
      help: string;
    }>(result.stdout);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Privacy Pools: Quick Guide");
    expect(result.stderr.trim()).toBe("");
  });

  test("init --mnemonic-stdin imports recovery phrase without leaking it", () => {
    const home = createTempHome();
    const { privateKeyPath } = writeTestSecretFiles(home);
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-stdin",
        "--private-key-file",
        privateKeyPath,
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home,
        input: `${TEST_MNEMONIC}\n`,
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(TEST_MNEMONIC);
    expect(result.stdout).not.toContain(TEST_PRIVATE_KEY);
  });

  test("init --private-key-stdin imports signer key without leaking it", () => {
    const home = createTempHome();
    const { mnemonicPath } = writeTestSecretFiles(home);
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-file",
        mnemonicPath,
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home,
        input: `${TEST_PRIVATE_KEY}\n`,
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(TEST_MNEMONIC);
    expect(result.stdout).not.toContain(TEST_PRIVATE_KEY);
  });

  test("init rejects using both stdin secret flags together", () => {
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-stdin",
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home: createTempHome(),
        input: `${TEST_MNEMONIC}\n`,
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ error: { category: string; message: string } }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Cannot read both recovery phrase and signer key from stdin");
  });

  test("init rejects empty mnemonic stdin", () => {
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home: createTempHome(),
        input: "",
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ error: { category: string; message: string } }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No valid recovery phrase found in stdin");
  });

  test("init rejects invalid private-key stdin", () => {
    const home = createTempHome();
    const { mnemonicPath } = writeTestSecretFiles(home);
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-file",
        mnemonicPath,
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home,
        input: "not-a-private-key\n",
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ error: { category: string; message: string } }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Invalid private key format");
  });

  test("init rejects empty private-key stdin", () => {
    const home = createTempHome();
    const { mnemonicPath } = writeTestSecretFiles(home);
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-file",
        mnemonicPath,
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home,
        input: "",
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ error: { category: string; message: string } }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No private key received on stdin");
  });

  test("accounts compact modes fail fast on invalid flag combinations", () => {
    const summaryAndPending = runCli(
      ["--json", "accounts", "--summary", "--pending-only"],
      { home: createTempHome() },
    );
    expect(summaryAndPending.status).toBe(2);
    expect(summaryAndPending.stdout).toContain("Cannot specify both --summary and --pending-only");

    const summaryAndDetails = runCli(
      ["--json", "accounts", "--summary", "--details"],
      { home: createTempHome() },
    );
    expect(summaryAndDetails.status).toBe(2);
    expect(summaryAndDetails.stdout).toContain("do not support --details");
  });

  test("deposit --agent rejects non-round amounts before wallet checks", () => {
    const result = runCli(
      ["--agent", "deposit", "1.276848", "ETH", "--chain", "sepolia"],
      {
        home: createTempHome(),
        env: fixtureEnv(),
        timeoutMs: 15_000,
      },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string; hint: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Non-round amount 1.276848 ETH may reduce privacy");
    expect(json.error.hint).toContain("--ignore-unique-amount");
    expect(json.error.hint).not.toContain("privacy-pools init");
    expect(result.stderr.trim()).toBe("");
  });

  test("deposit --agent --ignore-unique-amount advances past privacy guard", () => {
    const result = runCli(
      ["--agent", "deposit", "1.276848", "ETH", "--ignore-unique-amount", "--chain", "sepolia"],
      {
        home: createTempHome(),
        env: fixtureEnv(),
        timeoutMs: 15_000,
      },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string; hint: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No recovery phrase found");
    expect(json.error.message).not.toContain("Non-round amount");
    expect(json.error.hint).toContain("privacy-pools init");
    expect(result.stderr.trim()).toBe("");
  });
});
