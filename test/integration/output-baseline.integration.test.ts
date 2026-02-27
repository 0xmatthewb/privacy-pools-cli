/**
 * Output baseline lock.
 *
 * Captures current stdout/stderr/exit-code contracts for every output path
 * that will be touched by the output-module refactor.
 *
 * Categories:
 *   1. Human-mode smoke tests  (stderr patterns, stdout empty)
 *   2. JSON-mode envelope tests (stdout JSON, stderr silent)
 *   3. --unsigned error envelope tests
 *   4. --dry-run flag acceptance
 *   5. Error envelope completeness
 */

import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  initSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ──────────────────────────────────────────────────────────────────────────────

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

function seededHome(chain: string = "sepolia"): string {
  const home = createTempHome();
  initSeededHome(home, chain);
  return home;
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Human-mode smoke tests
// ──────────────────────────────────────────────────────────────────────────────

describe("human-mode output contracts", () => {
  test("guide: stderr contains guide text, stdout is empty", () => {
    const result = runCli(["guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Privacy Pools CLI - Quick Guide");
    expect(result.stdout.trim()).toBe("");
  });

  test("guide --quiet: stderr is empty, stdout is empty", () => {
    const result = runCli(["--quiet", "guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout.trim()).toBe("");
  });

  test("capabilities: stderr contains command list, stdout is empty", () => {
    const result = runCli(["capabilities"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Agent Capabilities");
    expect(result.stderr).toContain("Commands:");
    expect(result.stderr).toContain("Global Flags:");
    expect(result.stderr).toContain("Typical Agent Workflow:");
    expect(result.stdout.trim()).toBe("");
  });

  test("status (no init): stderr shows warnings, stdout is empty", () => {
    const result = runCli(["--no-banner", "status"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Privacy Pools CLI Status");
    expect(result.stderr).toContain("Config not found");
    expect(result.stdout.trim()).toBe("");
  });

  test("status (with init): stderr shows config, stdout is empty", () => {
    const home = seededHome();
    const result = runCli(["--no-banner", "status"], { home });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Privacy Pools CLI Status");
    expect(result.stderr).toContain("Recovery phrase: set");
    expect(result.stderr).toContain("Signer:");
    expect(result.stdout.trim()).toBe("");
  });

  test("completion bash: stdout contains completion script", () => {
    const result = runCli(["completion", "bash"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("_privacy_pools_completion");
  });

  test("completion zsh: stdout contains completion script", () => {
    const result = runCli(["completion", "zsh"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("compdef");
  });

  test("human-mode error: stderr has Error prefix, stdout is empty", () => {
    const home = seededHome();
    const result = runCli(["deposit", "0.01", "--yes", "--chain", "sepolia"], {
      home,
      env: OFFLINE_ENV,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Error [INPUT]");
    expect(result.stdout.trim()).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. JSON-mode envelope completeness
// ──────────────────────────────────────────────────────────────────────────────

describe("JSON-mode envelope completeness", () => {
  test("guide --json: stdout has schemaVersion and success", () => {
    const result = runCli(["--json", "guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      guide: string;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(typeof json.guide).toBe("string");
    expect(result.stderr.trim()).toBe("");
  });

  test("capabilities --json: stdout has full catalog", () => {
    const result = runCli(["--json", "capabilities"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      commands: Array<{ name: string; description: string }>;
      globalFlags: Array<{ flag: string; description: string }>;
      agentWorkflow: string[];
      jsonOutputContract: string;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.commands.length).toBeGreaterThan(0);
    expect(json.globalFlags.length).toBeGreaterThan(0);
    expect(json.agentWorkflow.length).toBeGreaterThan(0);
    expect(typeof json.jsonOutputContract).toBe("string");
    expect(result.stderr.trim()).toBe("");
  });

  test("status --json (no init): stdout has configExists=false", () => {
    const result = runCli(["--json", "status"], { home: createTempHome() });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      configExists: boolean;
      mnemonicSet: boolean;
      signerKeySet: boolean;
      signerAddress: string | null;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.configExists).toBe(false);
    expect(json.mnemonicSet).toBe(false);
    expect(json.signerKeySet).toBe(false);
    expect(json.signerAddress).toBeNull();
    expect(result.stderr.trim()).toBe("");
  });

  test("status --json (with init): stdout has complete status", () => {
    const home = seededHome();
    const result = runCli(["--json", "status"], { home });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      configExists: boolean;
      defaultChain: string;
      mnemonicSet: boolean;
      signerKeySet: boolean;
      signerKeyValid: boolean;
      signerAddress: string | null;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.configExists).toBe(true);
    expect(json.mnemonicSet).toBe(true);
    expect(json.signerKeySet).toBe(true);
    expect(json.signerKeyValid).toBe(true);
    expect(typeof json.signerAddress).toBe("string");
    expect(result.stderr.trim()).toBe("");
  });

  test("completion --json bash: stdout has completion-script envelope", () => {
    const result = runCli(["--json", "completion", "bash"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      shell: string;
      completionScript: string;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-script");
    expect(json.shell).toBe("bash");
    expect(typeof json.completionScript).toBe("string");
    expect(result.stderr.trim()).toBe("");
  });

  test("sync --json (ASP offline): error envelope with ASP category", () => {
    const home = seededHome("ethereum");
    const result = runCli(["--json", "--chain", "ethereum", "sync"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_ENV,
    });
    expect(result.status).toBe(4);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: {
        category: string;
        message: string;
        code: string;
      };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(typeof json.errorCode).toBe("string");
    expect(typeof json.errorMessage).toBe("string");
    expect(json.error.category).toBe("ASP");
    expect(result.stderr.trim()).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. --agent mode (JSON + quiet + yes)
// ──────────────────────────────────────────────────────────────────────────────

describe("--agent mode output contracts", () => {
  test("--agent guide: JSON on stdout, stderr empty", () => {
    const result = runCli(["--agent", "guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      guide: string;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
  });

  test("--agent capabilities: JSON on stdout, stderr empty", () => {
    const result = runCli(["--agent", "capabilities"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      commands: unknown[];
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
  });

  test("--agent status: JSON on stdout, stderr empty", () => {
    const home = seededHome();
    const result = runCli(["--agent", "status"], { home });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
  });

  test("--agent completion bash: JSON on stdout, stderr empty", () => {
    const result = runCli(["--agent", "completion", "bash"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-script");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Error envelope completeness – all required fields present
// ──────────────────────────────────────────────────────────────────────────────

describe("error envelope field completeness", () => {
  test("INPUT error has all envelope fields", () => {
    const result = runCli(["--json", "deposit", "0.1", "--yes"], {
      home: seededHome(),
    });
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: {
        code: string;
        category: string;
        message: string;
      };
    }>(result.stdout);

    // All top-level fields present
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(typeof json.errorCode).toBe("string");
    expect(typeof json.errorMessage).toBe("string");

    // Nested error object
    expect(typeof json.error.code).toBe("string");
    expect(json.error.category).toBe("INPUT");
    expect(typeof json.error.message).toBe("string");
  });

  test("ASP error has all envelope fields", () => {
    const home = seededHome("ethereum");
    const result = runCli(["--json", "--chain", "ethereum", "balance"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_ENV,
    });
    expect(result.status).toBe(4);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: {
        code: string;
        category: string;
        message: string;
      };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(typeof json.errorCode).toBe("string");
    expect(typeof json.errorMessage).toBe("string");
    expect(json.error.category).toBe("ASP");
  });

  test("unknown command error has all envelope fields", () => {
    const result = runCli(["--json", "not-a-command"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: {
        code: string;
        category: string;
        message: string;
      };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.category).toBe("INPUT");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. --unsigned error envelopes
// ──────────────────────────────────────────────────────────────────────────────

describe("--unsigned error envelopes", () => {
  test("deposit --unsigned without --asset: JSON error on stdout", () => {
    const home = seededHome();
    const result = runCli(["deposit", "0.1", "--unsigned"], { home });
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("withdraw --unsigned without --to: JSON error on stdout", () => {
    const home = seededHome();
    const result = runCli(
      ["withdraw", "0.1", "--unsigned", "--asset", "ETH"],
      { home }
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("ragequit --unsigned without --asset: JSON error on stdout", () => {
    const home = seededHome();
    const result = runCli(["ragequit", "--unsigned"], { home });
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("--unsigned-format without --unsigned: INPUT error", () => {
    const home = seededHome();
    const result = runCli(
      ["--json", "deposit", "0.1", "--asset", "ETH", "--unsigned-format", "tx"],
      { home }
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorMessage: string;
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorMessage).toContain("--unsigned-format requires --unsigned");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. --dry-run output contracts
// ──────────────────────────────────────────────────────────────────────────────

describe("--dry-run output contracts", () => {
  test("deposit --dry-run human mode: stderr error, stdout empty", () => {
    const home = seededHome();
    const result = runCli(["deposit", "0.01", "--dry-run", "--chain", "sepolia"], {
      home,
      timeoutMs: 10_000,
      env: OFFLINE_ENV,
    });
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("Error [INPUT]");
  });

  test("deposit --dry-run --json: JSON error envelope for missing asset", () => {
    const home = seededHome();
    const result = runCli(
      ["--json", "deposit", "0.01", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_ENV }
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No asset specified");
    expect(result.stderr.trim()).toBe("");
  });

  test("withdraw --dry-run --json: JSON error for missing asset", () => {
    const home = seededHome();
    const result = runCli(
      [
        "--json", "withdraw", "0.01", "--dry-run", "--direct",
        "--to", "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
        "--chain", "sepolia",
      ],
      { home, timeoutMs: 10_000, env: OFFLINE_ENV }
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("ragequit --dry-run --json: JSON error for missing asset", () => {
    const home = seededHome();
    const result = runCli(
      ["--json", "ragequit", "--dry-run", "--chain", "sepolia"],
      { home, timeoutMs: 10_000, env: OFFLINE_ENV }
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. stdout/stderr stream separation
// ──────────────────────────────────────────────────────────────────────────────

describe("stdout/stderr stream separation", () => {
  test("JSON success goes to stdout only", () => {
    const result = runCli(["--json", "status"], { home: seededHome() });
    expect(result.status).toBe(0);
    // stdout must be valid JSON
    const json = JSON.parse(result.stdout.trim());
    expect(json.success).toBe(true);
    // stderr must be empty in JSON mode
    expect(result.stderr.trim()).toBe("");
  });

  test("JSON error goes to stdout only", () => {
    const result = runCli(["--json", "deposit", "0.1", "--yes"], {
      home: seededHome(),
    });
    expect(result.status).toBe(2);
    // stdout must be valid JSON
    const json = JSON.parse(result.stdout.trim());
    expect(json.success).toBe(false);
    // stderr must be empty in JSON mode
    expect(result.stderr.trim()).toBe("");
  });

  test("human-mode error goes to stderr only", () => {
    const result = runCli(["deposit", "0.1", "--yes"], { home: seededHome() });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Error");
    expect(result.stdout.trim()).toBe("");
  });

  test("human-mode success output goes to stderr only (status command)", () => {
    const result = runCli(["--no-banner", "status"], { home: seededHome() });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Privacy Pools CLI Status");
    expect(result.stdout.trim()).toBe("");
  });
});
