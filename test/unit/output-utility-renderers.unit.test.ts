/**
 * Unit tests for utility output renderers: guide, capabilities, completion, sync, status.
 */

import { describe, expect, test } from "bun:test";
import {
  CLI_PROTOCOL_PROFILE,
  buildRuntimeCompatibilityDescriptor,
} from "../../src/config/protocol-profile.js";
import { createOutputContext } from "../../src/output/common.ts";
import { renderGuide } from "../../src/output/guide.ts";
import {
  renderCapabilities,
  type CapabilitiesPayload,
} from "../../src/output/capabilities.ts";
import {
  renderCommandDescription,
  type DetailedCommandDescriptor,
} from "../../src/output/describe.ts";
import {
  renderCompletionScript,
  renderCompletionQuery,
} from "../../src/output/completion.ts";
import { renderSyncEmpty, renderSyncComplete } from "../../src/output/sync.ts";
import {
  renderStatus,
  type StatusCheckResult,
} from "../../src/output/status.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { CLIError } from "../../src/utils/errors.ts";
import {
  makeMode,
  captureJsonOutput,
  captureOutput,
} from "../helpers/output.ts";

function expectNextAction(
  action: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
  cliCommand: string,
): void {
  expect(action).toMatchObject(expected);
  expect(action?.cliCommand).toBe(cliCommand);
}

// ── renderGuide parity ──────────────────────────────────────────────────────

describe("renderGuide parity", () => {
  test("JSON mode: emits guide envelope to stdout, nothing to stderr", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json, stderr } = captureJsonOutput(() => renderGuide(ctx));
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(typeof json.help).toBe("string");
    expect(stderr).toBe("");
  });

  test("human mode: emits guide text to stderr, nothing to stdout", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderGuide(ctx));

    expect(stdout).toBe("");
    // Guide outputs structural sections to stderr
    expect(stderr).toContain("Privacy Pools: Quick Guide");
    expect(stderr).not.toContain("Quick guide:");
    expect(stderr).toContain("Quick Start");
    expect(stderr).toContain("Workflow");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderGuide(ctx));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderCapabilities parity ───────────────────────────────────────────────

const STUB_CAPABILITIES: CapabilitiesPayload = {
  commands: [
    { name: "test-cmd", description: "Test command", requiresInit: false },
  ],
  commandDetails: {
    "test-cmd": {
      command: "test-cmd",
      description: "Test command",
      aliases: [],
      execution: {
        owner: "native-shell",
        nativeModes: ["default", "help"],
      },
      usage: "test-cmd",
      flags: ["--flag"],
      globalFlags: ["-j, --json"],
      requiresInit: false,
      expectedLatencyClass: "fast",
      safeReadOnly: true,
      prerequisites: [],
      examples: ["privacy-pools test-cmd --flag"],
      jsonFields: "{ ok }",
      jsonVariants: [],
      safetyNotes: [],
      supportsUnsigned: false,
      supportsDryRun: false,
      agentWorkflowNotes: [],
      sideEffectClass: "read_only",
      touchesFunds: false,
      requiresHumanReview: false,
    },
  },
  executionRoutes: {
    "test-cmd": {
      owner: "native-shell",
      nativeModes: ["default", "help"],
    },
  },
  globalFlags: [{ flag: "-j, --json", description: "JSON output" }],
  agentWorkflow: ["1. do something"],
  protocol: CLI_PROTOCOL_PROFILE,
  runtime: buildRuntimeCompatibilityDescriptor("1.7.0"),
  jsonOutputContract: "test contract",
};

const STUB_DESCRIPTOR: DetailedCommandDescriptor =
  STUB_CAPABILITIES.commandDetails["test-cmd"]!;

describe("renderCapabilities parity", () => {
  test("JSON mode: emits capabilities envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json, stderr } = captureJsonOutput(() =>
      renderCapabilities(ctx, STUB_CAPABILITIES),
    );
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.commands).toEqual(STUB_CAPABILITIES.commands);
    expect(json.globalFlags).toEqual(STUB_CAPABILITIES.globalFlags);
    expect(stderr).toBe("");
  });

  test("human mode: emits formatted text to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCapabilities(ctx, STUB_CAPABILITIES),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Agent Capabilities");
    expect(stderr).toContain("Commands:");
    expect(stderr).toContain("test-cmd");
    expect(stderr).toContain("Global flags:");
    expect(stderr).toContain("Typical agent workflow:");
    expect(stderr).toContain("Protocol profile:");
    expect(stderr).toContain("Runtime compatibility:");
  });
});

// ── renderCompletionScript parity ───────────────────────────────────────────

describe("renderCompletionScript parity", () => {
  test("JSON mode: emits completion-script envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json, stderr } = captureJsonOutput(() =>
      renderCompletionScript(ctx, "bash", "# test script\n"),
    );
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-script");
    expect(json.shell).toBe("bash");
    expect(json.completionScript).toBe("# test script\n");
    expect(stderr).toBe("");
  });

  test("human mode: emits script to stdout (not stderr)", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCompletionScript(ctx, "bash", "# test script\n"),
    );

    expect(stdout).toBe("# test script\n");
    expect(stderr).toBe("");
  });

  test("human mode: appends newline if script doesn't end with one", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout } = captureOutput(() =>
      renderCompletionScript(ctx, "bash", "# no trailing newline"),
    );

    expect(stdout).toBe("# no trailing newline\n");
  });
});

// ── renderCompletionQuery parity ────────────────────────────────────────────

describe("renderCompletionQuery parity", () => {
  test("JSON mode: emits completion-query envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json, stderr } = captureJsonOutput(() =>
      renderCompletionQuery(ctx, "zsh", 2, ["deposit", "withdraw"]),
    );
    expect(json.mode).toBe("completion-query");
    expect(json.shell).toBe("zsh");
    expect(json.cword).toBe(2);
    expect(json.candidates).toEqual(["deposit", "withdraw"]);
    expect(stderr).toBe("");
  });

  test("human mode: emits newline-separated candidates to stdout", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCompletionQuery(ctx, "bash", undefined, ["deposit", "withdraw"]),
    );

    expect(stdout).toBe("deposit\nwithdraw\n");
    expect(stderr).toBe("");
  });

  test("human mode: empty candidates produce no output", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCompletionQuery(ctx, "bash", 0, []),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderCommandDescription parity ─────────────────────────────────────────

describe("renderCommandDescription parity", () => {
  test("JSON mode: emits descriptor envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json, stderr } = captureJsonOutput(() =>
      renderCommandDescription(ctx, STUB_DESCRIPTOR),
    );
    expect(json.command).toBe("test-cmd");
    expect(json.flags).toEqual(["--flag"]);
    expect(stderr).toBe("");
  });

  test("human mode: emits descriptor summary to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCommandDescription(ctx, STUB_DESCRIPTOR),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Command: test-cmd");
    expect(stderr).toMatch(/Usage:\s+privacy-pools test-cmd/);
    expect(stderr).toContain("Flags:");
    expect(stderr).toContain("--flag");
  });
});

// ── renderSyncEmpty parity ──────────────────────────────────────────────────

describe("renderSyncEmpty parity", () => {
  test("JSON mode: emits zero-pool envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json, stderr } = captureJsonOutput(() =>
      renderSyncEmpty(ctx, "sepolia"),
    );
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.syncedPools).toBe(0);
    expect(json.availablePoolAccounts).toBe(0);
    expect(stderr).toBe("");
  });

  test("human mode: emits info to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderSyncEmpty(ctx, "sepolia"),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("No synced Pool Accounts are available on sepolia yet.");
  });
});

// ── renderSyncComplete parity ───────────────────────────────────────────────

describe("renderSyncComplete parity", () => {
  test("JSON mode: emits sync result envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json, stderr } = captureJsonOutput(() =>
      renderSyncComplete(ctx, {
        chain: "mainnet",
        syncedPools: 2,
        syncedSymbols: ["ETH", "DAI"],
        availablePoolAccounts: 5,
      }),
    );

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("mainnet");
    expect(json.syncedPools).toBe(2);
    expect(json.syncedSymbols).toEqual(["ETH", "DAI"]);
    expect(json.availablePoolAccounts).toBe(5);
    expect(stderr).toBe("");
  });

  test("human mode: emits success + info to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderSyncComplete(ctx, {
        chain: "mainnet",
        syncedPools: 2,
        availablePoolAccounts: 5,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Synced 2 pool(s) on mainnet");
    expect(stderr).toContain("Available Pool Accounts: 5");
  });

  test("human mode: falls back to zero instead of rendering undefined account counts", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderSyncComplete(ctx, {
        chain: "mainnet",
        syncedPools: 1,
        availablePoolAccounts: undefined as unknown as number,
      }),
    );

    expect(stderr).toContain("Available Pool Accounts: 0");
    expect(stderr).not.toContain("undefined");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderSyncComplete(ctx, {
        chain: "mainnet",
        syncedPools: 1,
        availablePoolAccounts: 0,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderStatus parity ─────────────────────────────────────────────────────

const STUB_STATUS: StatusCheckResult = {
  configExists: true,
  configDir: "/tmp/.privacy-pools",
  defaultChain: "sepolia",
  selectedChain: "sepolia",
  rpcUrl: "https://rpc.sepolia.example",
  rpcIsCustom: false,
  recoveryPhraseSet: true,
  signerKeySet: true,
  signerKeyValid: true,
  signerAddress: "0x1234567890abcdef1234567890abcdef12345678",
  entrypoint: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  aspHost: "https://asp.example",
  accountFiles: [["sepolia", 11155111]],
};

describe("renderStatus parity", () => {
  test("JSON mode: emits status envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json, stderr } = captureJsonOutput(() =>
      renderStatus(ctx, STUB_STATUS),
    );
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.configExists).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.selectedChain).toBe("sepolia");
    expect(json.recoveryPhraseSet).toBe(true);
    expect(json.signerKeySet).toBe(true);
    expect(json.signerAddress).toBe(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    expect(json.recommendedMode).toBe("ready");
    expect(json.warnings).toBeUndefined();
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "accounts",
        reason: "Check on your existing deposits.",
        when: "status_ready_has_accounts",
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools accounts --agent --chain sepolia",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode: includes aspLive/rpcLive when present", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const result = { ...STUB_STATUS, aspLive: true, rpcLive: false };
    const { json } = captureJsonOutput(() => renderStatus(ctx, result));
    expect(json.aspLive).toBe(true);
    expect(json.rpcLive).toBe(false);
    expect(json.recommendedMode).toBe("read-only");
    expect(json.warnings).toEqual([
      {
        code: "rpc_unreachable",
        message:
          "The configured RPC endpoint is unreachable. Read-only discovery and transaction preparation may be degraded.",
        affects: ["deposit", "withdraw", "unsigned", "discovery"],
      },
    ]);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "pools",
        reason:
          "Connectivity checks are degraded. Stay on public pool discovery until RPC and ASP health recover.",
        when: "status_degraded_health",
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools pools --agent --chain sepolia",
    );
  });

  test("JSON mode: emits init remediation in nextActions when setup is incomplete", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const result = {
      ...STUB_STATUS,
      configExists: false,
      configDir: null,
      recoveryPhraseSet: false,
      signerKeySet: false,
      signerKeyValid: false,
      signerAddress: null,
      accountFiles: [],
    };
    const { json } = captureJsonOutput(() => renderStatus(ctx, result));
    expect(json.recommendedMode).toBe("setup-required");
    expect(json.blockingIssues).toEqual([
      {
        code: "config_missing",
        message:
          "CLI configuration is missing. Run init before building or submitting wallet-dependent commands.",
        affects: ["deposit", "withdraw", "unsigned"],
      },
      {
        code: "recovery_phrase_missing",
        message:
          "No recovery phrase is configured. Wallet-dependent commands cannot run safely.",
        affects: ["deposit", "withdraw", "unsigned"],
      },
    ]);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "init",
        reason: "Complete CLI setup before transacting.",
        when: "status_not_ready",
        options: { agent: true, showRecoveryPhrase: true, defaultChain: "sepolia" },
      },
      "privacy-pools init --agent --show-recovery-phrase --default-chain sepolia",
    );
  });

  test("JSON mode: keeps unsigned-only follow-ups read-only when no signer is configured", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const result = {
      ...STUB_STATUS,
      signerKeySet: false,
      signerKeyValid: false,
      signerAddress: null,
      accountFiles: [],
    };
    const { json } = captureJsonOutput(() => renderStatus(ctx, result));
    expect(json.readyForDeposit).toBe(false);
    expect(json.readyForUnsigned).toBe(true);
    expect(json.recommendedMode).toBe("unsigned-only");
    expect(json.blockingIssues).toEqual([
      {
        code: "signer_key_missing",
        message:
          "No signer key is configured. Read-only commands remain safe, but deposits and withdrawals require a signer.",
        affects: ["deposit", "withdraw"],
      },
    ]);
    expect(json.warnings).toEqual([
      {
        code: "restore_discovery_recommended",
        message:
          "If you imported this recovery phrase from the website, you may have existing deposits on other chains. Run migrate status --all-chains to check.",
        affects: ["discovery"],
      },
    ]);
    expect(json.nextActions).toBeArrayOfSize(2);
    expectNextAction(
      json.nextActions[0],
      {
        command: "migrate status",
        reason:
          "If you imported this recovery phrase from the website, you may have existing deposits on other chains. Run migrate status --all-chains to check.",
        when: "status_restore_discovery",
        options: { agent: true, allChains: true },
      },
      "privacy-pools migrate status --agent --all-chains",
    );
    expectNextAction(
      json.nextActions[1],
      {
        command: "pools",
        reason:
          "Browse pools in read-only mode. Configure a valid signer key before depositing.",
        when: "status_unsigned_no_accounts",
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools pools --agent --chain sepolia",
    );
  });

  test("JSON mode: includes signer balance fields when available", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { json } = captureJsonOutput(() =>
      renderStatus(ctx, {
        ...STUB_STATUS,
        signerBalance: 123000000000000000n,
        signerBalanceDecimals: 18,
        signerBalanceSymbol: "ETH",
      }),
    );

    expect(json.signerBalance).toBe("123000000000000000");
    expect(json.signerBalanceDecimals).toBe(18);
    expect(json.signerBalanceSymbol).toBe("ETH");
  });

  test("JSON mode: includes native acceleration advisory warnings when present", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const result = {
      ...STUB_STATUS,
      accountFiles: [["mainnet", 1]] as [string, number][],
      nativeRuntimeAdvisory: {
        code: "native_acceleration_unavailable",
        message:
          "The optional native runtime for this supported host is unavailable or invalid, so the CLI is using the safe JS path. All commands remain available, but read-only discovery commands may be slower. Reinstall without --omit=optional and ensure optional dependencies are enabled.",
        affects: ["discovery"],
      },
    };

    const { json } = captureJsonOutput(() => renderStatus(ctx, result));
    expect(json.recommendedMode).toBe("ready");
    expect(json.warnings).toEqual([
      {
        code: "native_acceleration_unavailable",
        message:
          "The optional native runtime for this supported host is unavailable or invalid, so the CLI is using the safe JS path. All commands remain available, but read-only discovery commands may be slower. Reinstall without --omit=optional and ensure optional dependencies are enabled.",
        affects: ["discovery"],
      },
    ]);
  });

  test("human mode: emits status text to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderStatus(ctx, STUB_STATUS),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools CLI Status");
    expect(stderr).toContain("Config:");
    expect(stderr).toMatch(/Recovery phrase:\s+set/);
    expect(stderr).toContain("Signer key:");
    expect(stderr).toMatch(/Default chain:\s+sepolia/);
    expect(stderr).toMatch(/Ready\s+[·\-]/); // inline separator is · (unicode) or - (ascii)
    expect(stderr).toContain("Saved deposit state:");
  });

  test("human mode: shows signer balance when available", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderStatus(ctx, {
        ...STUB_STATUS,
        signerBalance: 123000000000000000n,
        signerBalanceDecimals: 18,
        signerBalanceSymbol: "ETH",
      }),
    );

    expect(stderr).toContain("Signer balance:");
    expect(stderr).toContain("0.12 ETH");
  });

  test("human mode: shows health check skipped message when no checks", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderStatus(ctx, STUB_STATUS));

    expect(stderr).toMatch(/Checks:\s+skipped/);
  });

  test("human mode: shows setup complete when config+mnemonic+signer present", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderStatus(ctx, STUB_STATUS));

    expect(stderr).toContain("Wallet setup and current health checks are ready");
  });

  test("human mode: shows unsigned-only readiness when no signer key", () => {
    const ctx = createOutputContext(makeMode());
    const result = {
      ...STUB_STATUS,
      signerKeySet: false,
      signerKeyValid: false,
      signerAddress: null,
    };
    const { stderr } = captureOutput(() => renderStatus(ctx, result));

    expect(stderr).toContain("No signer key is configured");
    expect(stderr).toContain("Read-only commands remain safe");
  });

  test("human mode: shows not-ready when no config", () => {
    const ctx = createOutputContext(makeMode());
    const result = {
      ...STUB_STATUS,
      configExists: false,
      configDir: null,
      recoveryPhraseSet: false,
      signerKeySet: false,
      signerKeyValid: false,
      signerAddress: null,
    };
    const { stderr } = captureOutput(() => renderStatus(ctx, result));

    expect(stderr).toContain("Setup required");
    expect(stderr).toContain("privacy-pools init");
  });
});

// ── CSV guard: utility renderers throw on --format csv ──────────────────────

describe("CSV guard: utility renderers", () => {
  const csvCtx = createOutputContext(makeMode({ isCsv: true }));

  test("renderSyncEmpty throws CLIError for CSV", () => {
    expect(() => renderSyncEmpty(csvCtx, "sepolia")).toThrow(CLIError);
  });

  test("renderSyncComplete throws CLIError for CSV", () => {
    expect(() =>
      renderSyncComplete(csvCtx, {
        chain: "mainnet",
        syncedPools: 1,
        availablePoolAccounts: 0,
      }),
    ).toThrow(CLIError);
  });

  test("renderStatus throws CLIError for CSV", () => {
    expect(() => renderStatus(csvCtx, STUB_STATUS)).toThrow(CLIError);
  });

  test("renderGuide throws CLIError for CSV", () => {
    expect(() => renderGuide(csvCtx)).toThrow(CLIError);
  });

  test("renderCapabilities throws CLIError for CSV", () => {
    expect(() =>
      renderCapabilities(csvCtx, {
        binaryName: "privacy-pools",
        version: "1.0.0",
        schemaVersion: JSON_SCHEMA_VERSION,
        commands: [],
        globalFlags: [],
        agentWorkflow: [],
      }),
    ).toThrow(CLIError);
  });
});

// ── Quiet mode: sync renderers ──────────────────────────────────────────────

describe("renderSyncEmpty quiet mode", () => {
  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderSyncEmpty(ctx, "sepolia"),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});
