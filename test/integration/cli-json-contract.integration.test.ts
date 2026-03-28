import { describe, expect, test } from "bun:test";
import {
  buildTestInitArgs,
  createSeededHome,
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

describe("JSON contract coverage", () => {
  test("status --json without init returns the readiness contract", () => {
    const result = runCli(["--json", "status"], {
      home: createTempHome(),
      timeoutMs: 10_000,
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      configExists: boolean;
      recoveryPhraseSet: boolean;
      signerKeySet: boolean;
      signerAddress: string | null;
      readyForDeposit: boolean;
      readyForWithdraw: boolean;
      readyForUnsigned: boolean;
      recommendedMode: string;
      blockingIssues?: Array<{ code: string; affects: string[] }>;
      warnings?: Array<{ code: string; affects: string[] }>;
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.configExists).toBe(false);
    expect(json.recoveryPhraseSet).toBe(false);
    expect(json.signerKeySet).toBe(false);
    expect(json.signerAddress).toBeNull();
    expect(json.readyForDeposit).toBe(false);
    expect(json.readyForWithdraw).toBe(false);
    expect(json.readyForUnsigned).toBe(false);
    expect(json.recommendedMode).toBe("setup-required");
    expect(json.blockingIssues?.map((issue) => issue.code)).toContain("config_missing");
    expect(json.blockingIssues?.map((issue) => issue.code)).toContain("recovery_phrase_missing");
  });

  test("status --json with init keeps semantic health fields", () => {
    const home = createSeededHome("sepolia");

    const result = runCli(
      ["--json", "--rpc-url", "http://127.0.0.1:9", "status"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      configExists: boolean;
      defaultChain: string;
      selectedChain: string;
      recoveryPhraseSet: boolean;
      signerKeySet: boolean;
      signerKeyValid: boolean;
      signerAddress: string | null;
      recommendedMode: string;
      warnings?: Array<{ code: string; affects: string[] }>;
      aspLive?: boolean;
      rpcLive?: boolean;
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.configExists).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.selectedChain).toBe("sepolia");
    expect(json.recoveryPhraseSet).toBe(true);
    expect(json.signerKeySet).toBe(true);
    expect(json.signerKeyValid).toBe(true);
    expect(json.recommendedMode).toBe("ready");
    expect(typeof json.signerAddress).toBe("string");
    expect(typeof json.aspLive).toBe("boolean");
    expect(typeof json.rpcLive).toBe("boolean");
    expect(json.warnings?.map((issue) => issue.code)).toContain("rpc_unreachable");
    expect(json.warnings?.map((issue) => issue.code)).toContain("asp_unreachable");
  });

  test("capabilities --json exposes the expected machine metadata", () => {
    const result = runCli(["--json", "capabilities"], {
      home: createTempHome(),
      timeoutMs: 10_000,
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      commands: Array<{ name: string }>;
      commandDetails: Record<string, {
        command: string;
        usage?: string;
        sideEffectClass: string;
        touchesFunds: boolean;
        requiresHumanReview: boolean;
        preferredSafeVariant?: { command: string; reason: string };
      }>;
      documentation?: { reference?: string; agentGuide?: string };
      safeReadOnlyCommands: string[];
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.commands.map((command) => command.name)).toContain("withdraw quote");
    expect(json.commands.map((command) => command.name)).toContain("capabilities");
    expect(json.commandDetails["withdraw quote"]?.command).toBe("withdraw quote");
    expect(json.commandDetails["withdraw quote"]?.usage).toBe("withdraw quote <amount|asset> [amount]");
    expect(json.commandDetails["withdraw"]?.sideEffectClass).toBe("fund_movement");
    expect(json.commandDetails["withdraw"]?.touchesFunds).toBe(true);
    expect(json.commandDetails["withdraw"]?.requiresHumanReview).toBe(true);
    expect(json.commandDetails["withdraw"]?.preferredSafeVariant?.command).toBe("withdraw quote");
    expect(json.commandDetails["guide"]?.sideEffectClass).toBe("read_only");
    expect(json.documentation).toMatchObject({
      reference: "docs/reference.md",
      agentGuide: "AGENTS.md",
    });
    expect(json.safeReadOnlyCommands).toContain("status");
  });

  test("activity --json offline contract stays machine-parseable", () => {
    const result = runCli(["--json", "--chain", "mainnet", "activity"], {
      home: createTempHome(),
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(result.status).toBe(1);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; retryable: boolean; hint: string };
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNKNOWN_ERROR");
    expect(json.errorMessage).toContain("Unable to connect");
    expect(json.error.category).toBe("UNKNOWN");
    expect(json.error.retryable).toBe(false);
    expect(json.error.hint).toContain("report it");
  });

  test("stats --json offline contract stays machine-parseable", () => {
    const result = runCli(["--json", "stats"], {
      home: createTempHome(),
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(result.status).toBe(1);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; retryable: boolean };
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNKNOWN_ERROR");
    expect(json.errorMessage).toContain("Unable to connect");
    expect(json.error.category).toBe("UNKNOWN");
    expect(json.error.retryable).toBe(false);
  });

  test("pools --json offline contract keeps the ASP error semantics", () => {
    const result = runCli(["--json", "--chain", "sepolia", "pools"], {
      home: createTempHome(),
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(result.status).toBe(4);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; code: string; retryable: boolean };
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ASP_ERROR");
    expect(json.errorMessage).toContain("Cannot reach ASP");
    expect(json.error.category).toBe("ASP");
    expect(json.error.code).toBe("ASP_ERROR");
    expect(json.error.retryable).toBe(false);
  });

  test("stats pool without --asset keeps the INPUT contract", () => {
    const result = runCli(["--json", "stats", "pool", "--chain", "sepolia"], {
      home: createTempHome(),
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; code: string; hint: string };
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.errorMessage).toBe("Missing required --asset <symbol|address>.");
    expect(json.error.category).toBe("INPUT");
    expect(json.error.code).toBe("INPUT_ERROR");
    expect(json.error.hint).toContain("stats pool --asset ETH");
  });

  test("init --json keeps the semantic setup contract", () => {
    const home = createTempHome();
    const result = runCli(
      buildTestInitArgs(home, { chain: "sepolia" }),
      { home, timeoutMs: 30_000 },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      defaultChain: string;
      signerKeySet: boolean;
      recoveryPhraseRedacted?: boolean;
      recoveryPhrase?: string;
      nextActions?: Array<{ command: string }>;
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.signerKeySet).toBe(true);
    expect(json.recoveryPhraseRedacted).toBeUndefined();
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.nextActions?.[0]?.command).toBe("accounts");
  });
});
