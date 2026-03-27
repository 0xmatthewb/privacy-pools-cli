/**
 * Unit tests for utility output renderers: guide, capabilities, completion, sync, status.
 */

import { describe, expect, test } from "bun:test";
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
  protocol: {
    family: "privacy-pools",
    generation: "v1",
    profile: "privacy-pools-v1",
    displayName: "Privacy Pools v1",
    coreSdkPackage: "@0xbow/privacy-pools-core-sdk",
    coreSdkVersion: "1.2.0",
    supportedChainPolicy: "cli-curated",
  },
  runtime: {
    cliVersion: "1.7.0",
    jsonSchemaVersion: JSON_SCHEMA_VERSION,
    accountFileVersion: 3,
    workflowSnapshotVersion: "1",
    workflowSecretVersion: "1",
    runtimeVersion: "v1",
    workerProtocolVersion: "1",
    manifestVersion: "1",
    nativeBridgeVersion: "1",
  },
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
    expect(stderr).toContain("Global Flags:");
    expect(stderr).toContain("Typical Agent Workflow:");
    expect(stderr).toContain("Protocol Profile:");
    expect(stderr).toContain("Runtime Compatibility:");
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
    expect(stderr).toContain("Usage: privacy-pools test-cmd");
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
    expect(stderr).toContain("No pools found on sepolia");
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
    expect(json.nextActions).toEqual([
      {
        command: "accounts",
        reason: "Check on your existing deposits.",
        when: "status_ready_has_accounts",
        options: { agent: true, chain: "sepolia" },
      },
    ]);
    expect(stderr).toBe("");
  });

  test("JSON mode: includes aspLive/rpcLive when present", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const result = { ...STUB_STATUS, aspLive: true, rpcLive: false };
    const { json } = captureJsonOutput(() => renderStatus(ctx, result));
    expect(json.aspLive).toBe(true);
    expect(json.rpcLive).toBe(false);
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
    expect(json.nextActions).toEqual([
      {
        command: "init",
        reason: "Complete CLI setup before transacting.",
        when: "status_not_ready",
        options: { agent: true, showMnemonic: true, defaultChain: "sepolia" },
      },
    ]);
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
    expect(json.nextActions).toEqual([
      {
        command: "pools",
        reason:
          "Browse pools in read-only mode. Configure a valid signer key before depositing.",
        when: "status_unsigned_no_accounts",
        options: { agent: true, chain: "sepolia" },
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
    expect(stderr).toContain("Recovery phrase: set");
    expect(stderr).toContain("Signer key:");
    expect(stderr).toContain("Default chain: sepolia");
    expect(stderr).toContain("Account files:");
  });

  test("human mode: shows health check skipped message when no checks", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderStatus(ctx, STUB_STATUS));

    expect(stderr).toContain("Health checks skipped");
  });

  test("human mode: shows setup complete when config+mnemonic+signer present", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderStatus(ctx, STUB_STATUS));

    expect(stderr).toContain("Setup complete.");
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

    expect(stderr).toContain("unsigned mode only");
    expect(stderr).toContain("no signer key");
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

    expect(stderr).toContain("Not ready");
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
