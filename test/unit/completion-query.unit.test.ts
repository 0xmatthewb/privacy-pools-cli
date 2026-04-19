import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "../../src/config/chains.ts";
import { saveAccount } from "../../src/services/account-storage.ts";
import { saveWorkflowSnapshot } from "../../src/services/workflow.ts";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";
import {
  detectCompletionShell,
  isCompletionShell,
  queryCompletionCandidates,
  STATIC_COMPLETION_SPEC,
  type CompletionCommandSpec,
} from "../../src/utils/completion-query.ts";

const ORIGINAL_PRIVACY_POOLS_HOME = process.env.PRIVACY_POOLS_HOME;

describe("completion query helpers", () => {
  afterEach(() => {
    if (ORIGINAL_PRIVACY_POOLS_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_PRIVACY_POOLS_HOME;
    }
    cleanupTrackedTempDirs();
  });

  function createCompletionHome(prefix: string): string {
    const home = createTrackedTempDir(prefix);
    process.env.PRIVACY_POOLS_HOME = home;
    return home;
  }

  test("detects supported shells and defaults Windows to PowerShell", () => {
    expect(isCompletionShell("bash")).toBe(true);
    expect(isCompletionShell("zsh")).toBe(true);
    expect(isCompletionShell("fish")).toBe(true);
    expect(isCompletionShell("powershell")).toBe(true);
    expect(isCompletionShell("tcsh")).toBe(false);

    expect(detectCompletionShell("/bin/zsh")).toBe("zsh");
    expect(detectCompletionShell("/opt/homebrew/bin/fish")).toBe("fish");
    expect(detectCompletionShell("/bin/bash")).toBe("bash");
    expect(detectCompletionShell("C:/Program Files/PowerShell/7/pwsh.exe")).toBe(
      "powershell",
    );
    expect(detectCompletionShell("")).toBe("bash");
    expect(detectCompletionShell("", "win32")).toBe("powershell");
    expect(detectCompletionShell("", "linux")).toBe("bash");
  });

  test("suggests top-level commands and global flags", () => {
    const candidates = queryCompletionCandidates(["privacy-pools"], 1);

    expect(candidates).toContain("flow");
    expect(candidates).toContain("withdraw");
    expect(candidates).toContain("--chain");
    expect(candidates).toContain("--agent");
  });

  test("normalizes empty argv and bare prefixes without requiring the command name", () => {
    expect(queryCompletionCandidates([], 1)).toEqual(
      expect.arrayContaining(["flow", "withdraw", "--chain"]),
    );

    expect(queryCompletionCandidates(["flo"], 1)).toEqual(["flow"]);
  });

  test("suggests flow subcommands with prefix filtering", () => {
    const candidates = queryCompletionCandidates(["privacy-pools", "flow", "st"], 2);

    expect(candidates).toEqual(["start", "status", "step"]);
  });

  test("suggests option values after value-taking flags", () => {
    expect(
      queryCompletionCandidates(["privacy-pools", "--chain", ""], 2),
    ).toEqual(expect.arrayContaining(["mainnet", "sepolia"]));

    expect(
      queryCompletionCandidates(["privacy-pools", "--output=j"], 1),
    ).toEqual(["--output=json"]);

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "flow", "start", "0.1", "ETH", "--privacy-delay", ""],
        6,
      ),
    ).toEqual(["balanced", "off", "strict"]);
  });

  test("suggests command JSON fields for preferred --json field selection syntax", () => {
    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "quote", "--json", "quote"],
        4,
      ),
    ).toEqual(expect.arrayContaining(["quoteExpiresAt", "quoteFeeBPS"]));

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "quote", "--json=quote"],
        3,
      ),
    ).toEqual(expect.arrayContaining([
      "--json=quoteExpiresAt",
      "--json=quoteFeeBPS",
    ]));

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "quote", "--json=amount,quote"],
        3,
      ),
    ).toEqual(expect.arrayContaining([
      "--json=amount,quoteExpiresAt",
      "--json=amount,quoteFeeBPS",
    ]));
  });

  test("keeps the hidden --json-fields compatibility alias working for completion", () => {
    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "quote", "--json-fields", "quote"],
        4,
      ),
    ).toEqual(expect.arrayContaining(["quoteExpiresAt", "quoteFeeBPS"]));

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "quote", "--json-fields=quote"],
        3,
      ),
    ).toEqual(expect.arrayContaining([
      "--json-fields=quoteExpiresAt",
      "--json-fields=quoteFeeBPS",
    ]));

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "quote", "--json-fields=amount,quote"],
        3,
      ),
    ).toEqual(expect.arrayContaining([
      "--json-fields=amount,quoteExpiresAt",
      "--json-fields=amount,quoteFeeBPS",
    ]));
  });

  test("returns no candidates when a free-form option value is expected", () => {
    expect(
      queryCompletionCandidates(["privacy-pools", "--rpc-url", ""], 2),
    ).toEqual([]);
  });

  test("suggests local asset symbols for positional and flag-based asset slots", () => {
    const configHome = createCompletionHome("pp-completion-assets-");
    mkdirSync(configHome, { recursive: true });
    writeFileSync(
      join(configHome, "config.json"),
      JSON.stringify({ defaultChain: "sepolia" }),
      "utf8",
    );
    process.env.PRIVACY_POOLS_HOME = configHome;

    try {
      expect(
        queryCompletionCandidates(
          ["privacy-pools", "deposit", "0.1", ""],
          3,
        ),
      ).toEqual(expect.arrayContaining(["ETH", "USDC", "USDT"]));

      expect(
        queryCompletionCandidates(
          ["privacy-pools", "withdraw", "--all", ""],
          3,
        ),
      ).toEqual(expect.arrayContaining(["ETH", "USDC", "USDT"]));

      expect(
        queryCompletionCandidates(
          ["privacy-pools", "withdraw", "quote", "0.1", ""],
          4,
        ),
      ).toEqual(expect.arrayContaining(["ETH", "USDC", "USDT"]));

      expect(
        queryCompletionCandidates(
          ["privacy-pools", "ragequit", ""],
          2,
        ),
      ).toEqual(expect.arrayContaining(["ETH", "USDC", "USDT"]));
    } finally {
      rmSync(configHome, { recursive: true, force: true });
    }
  });

  test("suggests pool account candidates from the default chain and flag=value form", () => {
    const configHome = createCompletionHome("pp-completion-pool-accounts-");
    writeFileSync(
      join(configHome, "config.json"),
      JSON.stringify({ defaultChain: "sepolia" }),
      "utf8",
    );
    saveAccount(CHAINS.sepolia.id, {
      poolAccounts: new Map([[1n, [{}, {}, {}]]]),
    });

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "--pool-account", ""],
        3,
      ),
    ).toEqual(["PA-1", "PA-2", "PA-3"]);

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "ragequit", "--pool-account=PA-"],
        2,
      ),
    ).toEqual(["--pool-account=PA-1", "--pool-account=PA-2", "--pool-account=PA-3"]);
  });

  test("scans all account files when no chain context is available", () => {
    createCompletionHome("pp-completion-account-scan-");
    saveAccount(CHAINS.mainnet.id, {
      poolAccounts: new Map([[1n, [{}, {}]]]),
    });
    saveAccount(CHAINS.arbitrum.id, {
      poolAccounts: new Map([[2n, [{}, {}, {}]]]),
    });

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "--pool-account", ""],
        3,
      ),
    ).toEqual(["PA-1", "PA-2", "PA-3"]);
  });

  test("suggests profiles for global flags and config profile use", () => {
    const configHome = createCompletionHome("pp-completion-profiles-");
    mkdirSync(join(configHome, "profiles", "alpha"), { recursive: true });
    mkdirSync(join(configHome, "profiles", "beta"), { recursive: true });

    expect(
      queryCompletionCandidates(["privacy-pools", "--profile", ""], 2),
    ).toEqual(["alpha", "beta", "default"]);

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "config", "profile", "use", ""],
        4,
      ),
    ).toEqual(["alpha", "beta", "default"]);
  });

  test("suggests saved workflow ids for flow commands", () => {
    createCompletionHome("pp-completion-workflows-");
    saveWorkflowSnapshot({
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-alpha",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      phase: "approved_ready_to_withdraw",
      chain: "mainnet",
      asset: "ETH",
      depositAmount: "100000000000000000",
      recipient: "0x1111111111111111111111111111111111111111",
    });
    saveWorkflowSnapshot({
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-beta",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      phase: "approved_ready_to_withdraw",
      chain: "mainnet",
      asset: "ETH",
      depositAmount: "200000000000000000",
      recipient: "0x2222222222222222222222222222222222222222",
    });

    expect(
      queryCompletionCandidates(["privacy-pools", "flow", "watch", ""], 3),
    ).toEqual(["latest", "wf-alpha", "wf-beta"]);

    expect(
      queryCompletionCandidates(["privacy-pools", "flow", "ragequit", "wf-b"], 3),
    ).toEqual(["wf-beta"]);
  });

  test("resolves chain-specific asset suggestions from --chain=value", () => {
    expect(
      queryCompletionCandidates(
        ["privacy-pools", "--chain=op-sepolia", "deposit", "0.1", ""],
        4,
      ),
    ).toEqual(["WETH"]);
  });

  test("resolves chain-specific asset suggestions from split --chain flags", () => {
    expect(
      queryCompletionCandidates(
        ["privacy-pools", "--chain", "op-sepolia", "deposit", "0.1", ""],
        5,
      ),
    ).toEqual(["WETH"]);
  });

  test("falls back to global asset suggestions when the saved config is unreadable", () => {
    const configHome = createCompletionHome("pp-completion-bad-config-");
    writeFileSync(join(configHome, "config.json"), "{", "utf8");

    expect(
      queryCompletionCandidates(["privacy-pools", "deposit", "0.1", ""], 3),
    ).toEqual(expect.arrayContaining(["ETH", "USDC", "USDT", "WETH"]));
  });

  test("supports split --chain pool-account completions and profile fallbacks", () => {
    const configHome = createCompletionHome("pp-completion-split-chain-");
    saveAccount(CHAINS.sepolia.id, {
      poolAccounts: new Map([[1n, [{}, {}]]]),
    });

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "withdraw", "--chain", "sepolia", "--pool-account", ""],
        5,
      ),
    ).toEqual(["PA-1", "PA-2"]);

    rmSync(join(configHome, "profiles"), { recursive: true, force: true });
    writeFileSync(join(configHome, "profiles"), "not-a-directory", "utf8");

    expect(
      queryCompletionCandidates(["privacy-pools", "--profile", ""], 2),
    ).toEqual(["default"]);
  });

  test("normalizes alternate binary names and custom specs", () => {
    const customSpec: CompletionCommandSpec = {
      name: "custom-cli",
      aliases: ["cc"],
      options: [{ names: ["--region"], takesValue: true, values: ["us", "eu"] }],
      subcommands: [
        {
          name: "deploy",
          aliases: ["ship"],
          options: [{ names: ["--env"], takesValue: true, values: ["dev", "prod"] }],
          subcommands: [],
        },
      ],
    };

    const valueCandidates = queryCompletionCandidates(
      ["custom-cli", "ship", "--env", ""],
      3,
      customSpec,
    );
    expect(valueCandidates).toEqual(["dev", "prod"]);

    const rootCandidates = queryCompletionCandidates(["custom-cli"], 1, customSpec);
    expect(rootCandidates).toContain("deploy");
    expect(rootCandidates).toContain("ship");
    expect(rootCandidates).toContain("--region");
  });

  test("static completion spec stays rooted at privacy-pools", () => {
    expect(STATIC_COMPLETION_SPEC.name).toBe("privacy-pools");
    expect(
      STATIC_COMPLETION_SPEC.subcommands?.find((subcommand) => subcommand.name === "flow"),
    ).toBeDefined();
  });
});
