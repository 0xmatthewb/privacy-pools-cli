/**
 * Exit-code matrix test (Stripe/GitHub pattern).
 *
 * Systematically verifies that every CLI error category maps to its
 * documented exit code. This prevents regressions where error paths
 * accidentally return the wrong exit code.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  CLI_CWD,
  createSeededHome,
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import {
  killFixtureServer,
  launchFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";
import { EXIT_CODES, type ErrorCategory } from "../../src/utils/errors.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};
const MALFORMED_RELAYER_RECIPIENT = "0x0000000000000000000000000000000000000002";

const EXIT_CODE_MAP = EXIT_CODES satisfies Record<ErrorCategory, number>;

function nodeBin(): string {
  return process.platform === "win32" ? "node.exe" : "node";
}

function renderCategoricalErrorScript(script: string) {
  const result = spawnSync(nodeBin(), [
    "--import",
    "tsx",
    "--eval",
    [
      "const { printError } = await import('./src/utils/errors.ts');",
      "const { toWithdrawSolidityProof } = await import('./src/utils/unsigned.ts');",
      script,
    ].join("\n"),
  ], {
    cwd: CLI_CWD,
    encoding: "utf8",
    timeout: 10_000,
    env: buildChildProcessEnv({
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      PRIVACY_POOLS_NO_UPDATE_CHECK: "1",
    }),
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

async function runCliInPythonPtyUntil(params: {
  args: string[];
  home: string;
  env?: Record<string, string | undefined>;
  waitFor: RegExp;
  input: string;
  timeoutMs?: number;
}): Promise<{ status: number | null; signal: NodeJS.Signals | null; output: string }> {
  const payload = JSON.stringify({
    command: nodeBin(),
    args: [
      "--import",
      "./src/runtime/color-env-bootstrap.ts",
      "--import",
      "tsx",
      "src/index.ts",
      ...params.args,
    ],
    cwd: CLI_CWD,
  });
  const timeoutMs = params.timeoutMs ?? 20_000;

  return await new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn("python3", ["-u", "scripts/lib/pty-proxy.py", payload], {
      cwd: CLI_CWD,
      env: buildChildProcessEnv({
        PRIVACY_POOLS_HOME: join(params.home, ".privacy-pools"),
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        PRIVACY_POOLS_NO_UPDATE_CHECK: "1",
        NO_COLOR: "1",
        ...params.env,
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    let prompted = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      rejectPromise(
        new Error(`Timed out waiting for interactive prompt:\n${output}`),
      );
    }, timeoutMs);

    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
      if (!prompted && params.waitFor.test(stripAnsi(output))) {
        prompted = true;
        proc.stdin?.write(params.input);
      }
    };

    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);
    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(error);
    });
    proc.on("exit", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!prompted) {
        rejectPromise(
          new Error(`Command exited before interactive prompt appeared:\n${output}`),
        );
        return;
      }
      resolvePromise({ status, signal, output });
    });
  });
}

describe("exit-code matrix", () => {
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
      PRIVACY_POOLS_RELAYER_HOST_SEPOLIA: fixture.url,
    };
  }

  test("INPUT error → exit code 2 (missing required option)", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "deposit", "0.01", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(EXIT_CODE_MAP.INPUT);
    const json = parseJsonOutput<{ error?: { category?: string } }>(result.stdout);
    expect(json.error?.category).toBe("INPUT");
  });

  test("ASP error → exit code 8 (offline ASP, pools command)", () => {
    const home = createTempHome();
    const result = runCli(
      ["--json", "pools", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(EXIT_CODE_MAP.ASP);
    const json = parseJsonOutput<{ error?: { category?: string } }>(result.stdout);
    expect(json.error?.category).toBe("ASP");
  }, 10_000);

  test("SETUP error → exit code 4 (wallet command before init)", () => {
    const home = createTempHome();
    const result = runCli(
      ["--json", "accounts", "--chain", "sepolia", "--no-sync"],
      { home, timeoutMs: 10_000 },
    );
    expect(result.status).toBe(EXIT_CODE_MAP.SETUP);
    const json = parseJsonOutput<{ error?: { category?: string } }>(result.stdout);
    expect(json.error?.category).toBe("SETUP");
  });

  test("RPC error → exit code 3 (offline RPC during account sync)", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "accounts", "--chain", "sepolia"],
      {
        home,
        timeoutMs: 15_000,
        env: {
          PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
        },
      },
    );
    expect(result.status).toBe(EXIT_CODE_MAP.RPC);
    const json = parseJsonOutput<{ error?: { category?: string } }>(result.stdout);
    expect(json.error?.category).toBe("RPC");
  });

  test("RELAYER error → exit code 5 (malformed relayer quote)", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      [
        "--json",
        "--chain",
        "sepolia",
        "withdraw",
        "quote",
        "0.1",
        "ETH",
        "--to",
        MALFORMED_RELAYER_RECIPIENT,
      ],
      { home, timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(EXIT_CODE_MAP.RELAYER);
    const json = parseJsonOutput<{ error?: { category?: string } }>(result.stdout);
    expect(json.error?.category).toBe("RELAYER");
  });

  test("PROOF error → exit code 6 (malformed proof conversion)", () => {
    const result = renderCategoricalErrorScript(`
      try {
        toWithdrawSolidityProof({
          proof: {
            pi_a: ["not-a-number", "2"],
            pi_b: [["1", "2"], ["3", "4"]],
            pi_c: ["1", "2"],
          },
          publicSignals: ["1", "2", "3", "4", "5", "6", "7", "8"],
        });
      } catch (error) {
        printError(error, true);
      }
    `);
    expect(result.status).toBe(EXIT_CODE_MAP.PROOF);
    expect(result.stderr).toBe("");
    const json = parseJsonOutput<{ error?: { category?: string; code?: string } }>(
      result.stdout,
    );
    expect(json.error?.category).toBe("PROOF");
    expect(json.error?.code).toBe("PROOF_MALFORMED");
  });

  test("CONTRACT error → exit code 7 (known revert classifier)", () => {
    const result = renderCategoricalErrorScript(
      "printError(new Error('execution reverted: InvalidProof'), true);",
    );
    expect(result.status).toBe(EXIT_CODE_MAP.CONTRACT);
    expect(result.stderr).toBe("");
    const json = parseJsonOutput<{ error?: { category?: string; code?: string } }>(
      result.stdout,
    );
    expect(json.error?.category).toBe("CONTRACT");
    expect(json.error?.code).toBe("CONTRACT_INVALID_PROOF");
  });

  test("CANCELLED error → exit code 9 (interactive prompt SIGINT)", async () => {
    const home = createSeededHome("sepolia");
    const interactive = await runCliInPythonPtyUntil({
      args: [
        "--no-banner",
        "--chain",
        "sepolia",
        "flow",
        "start",
        "0.1",
        "ETH",
      ],
      home,
      env: fixtureEnv(),
      waitFor: /recipient|withdraw/i,
      input: "\u0003",
    });
    expect(interactive.status).toBe(0);
    expect(stripAnsi(interactive.output)).toMatch(/Prompt cancelled|Operation cancelled/);

    const result = renderCategoricalErrorScript(`
      const cancelled = new Error('cancelled');
      cancelled.name = 'ExitPromptError';
      printError(cancelled, true);
    `);
    expect(EXIT_CODES.CANCELLED).toBe(9);
    expect(result.status).toBe(EXIT_CODE_MAP.CANCELLED);
    expect(result.stderr).toBe("");
    const json = parseJsonOutput<{ error?: { category?: string; code?: string } }>(
      result.stdout,
    );
    expect(json.error?.category).toBe("CANCELLED");
    expect(json.error?.code).toBe("PROMPT_CANCELLED");
  }, 30_000);

  test("UNKNOWN error → exit code 1 (unexpected fixture RPC method)", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "deposit", "0.1", "ETH", "--chain", "sepolia", "--yes", "--no-wait"],
      { home, timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(EXIT_CODE_MAP.UNKNOWN);
    const json = parseJsonOutput<{ error?: { category?: string } }>(result.stdout);
    expect(json.error?.category).toBe("UNKNOWN");
  });

  test("exit code 0 for successful commands (status)", () => {
    const home = createTempHome();
    const result = runCli(["--json", "status"], { home, timeoutMs: 10_000 });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{ success: boolean }>(result.stdout);
    expect(json.success).toBe(true);
  });

  test("exit code 0 for successful commands (capabilities)", () => {
    const home = createTempHome();
    const result = runCli(["--json", "capabilities"], { home, timeoutMs: 10_000 });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{ success: boolean }>(result.stdout);
    expect(json.success).toBe(true);
  });

  test("exit code 2 for unknown command", () => {
    const home = createTempHome();
    const result = runCli(["not-a-command"], { home });
    expect(result.status).toBe(2);
  });

  test("describe index stays a successful human-mode command without arguments", () => {
    const home = createTempHome();
    const result = runCli(["describe"], { home });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Describe: commands");
    expect(result.stderr).toContain("Available command paths");
  });

  test("describe index stays a successful structured-mode command without arguments", () => {
    const home = createTempHome();
    const result = runCli(["--json", "describe"], { home });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      mode?: string;
      commands?: Array<{ command?: string }>;
      envelopeRoots?: string[];
    }>(
      result.stdout,
    );
    expect(json.mode).toBe("describe-index");
    expect(json.commands?.some((entry) => entry.command === "withdraw")).toBe(true);
    expect(json.envelopeRoots).toEqual(expect.arrayContaining(["commands", "nextActions"]));
  });

  test("exit code 2 for invalid --limit value (history)", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--json", "history", "--limit", "-5"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    // Invalid limit should be INPUT error (exit 2)
    expect(result.status).toBe(EXIT_CODE_MAP.INPUT);
  });

  test("JSON error envelopes always include category and code fields", () => {
    const home = createSeededHome("sepolia");

    // Trigger an ASP error
    const result = runCli(
      ["--json", "pools", "--chain", "sepolia"],
      { home, timeoutMs: 20_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).not.toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      error?: { category?: string; code?: string; message?: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(typeof json.error?.category).toBe("string");
    expect(json.error?.code).toBe("ASP_ERROR");
    expect(typeof json.error?.message).toBe("string");
  }, 20_000);

  test("all documented exit codes are distinct positive integers", () => {
    const codes = Object.values(EXIT_CODE_MAP);
    expect(codes.length).toBe(9);
    expect(new Set(codes).size).toBe(9);
    for (const code of codes) {
      expect(Number.isInteger(code)).toBe(true);
      expect(code).toBeGreaterThan(0);
      expect(code).toBeLessThanOrEqual(9);
    }
  });
});
