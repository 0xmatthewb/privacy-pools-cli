import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "../../src/config/chains.ts";
import { saveAccount } from "../../src/services/account-storage.ts";
import { saveMnemonicToFile, saveSignerKey } from "../../src/services/config.ts";
import { saveWorkflowSnapshot } from "../../src/services/workflow.ts";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import {
  getWelcomeReadinessLabel,
  getWelcomeState,
} from "../../src/utils/welcome-readiness.ts";
import { cleanupTrackedTempDirs, createTrackedTempDir } from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_PRIVATE_KEY = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const MNEMONIC =
  "test test test test test test test test test test test junk";
const PRIVATE_KEY = `0x${"11".repeat(32)}`;

function useWelcomeHome(prefix: string): string {
  const home = createTrackedTempDir(prefix);
  process.env.PRIVACY_POOLS_HOME = home;
  delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
  return home;
}

describe("welcome readiness", () => {
  afterEach(() => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
    }

    if (ORIGINAL_PRIVATE_KEY === undefined) {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    } else {
      process.env.PRIVACY_POOLS_PRIVATE_KEY = ORIGINAL_PRIVATE_KEY;
    }

    cleanupTrackedTempDirs();
  });

  test("getWelcomeState guides brand-new users through init", () => {
    useWelcomeHome("pp-welcome-new-user-");

    const state = getWelcomeState();

    expect(state.kind).toBe("new_user");
    expect(state.readinessLabel).toBe("setup: run init");
    expect(state.bannerActions.map((action) => action.cliCommand)).toEqual([
      "init",
      "guide",
      "--help",
    ]);
    expect(getWelcomeReadinessLabel()).toBe("setup: run init");
  });

  test("getWelcomeState surfaces read-only deposits when recovery exists but no signer is configured", () => {
    const home = useWelcomeHome("pp-welcome-read-only-");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ defaultChain: "mainnet", rpcOverrides: {} }),
      "utf8",
    );
    saveMnemonicToFile(MNEMONIC);
    saveAccount(CHAINS.mainnet.id, {
      commitments: new Map(),
      poolAccounts: new Map([[1n, [{ value: 1n }]]]),
    });

    const state = getWelcomeState();

    expect(state.kind).toBe("read_only_with_deposits");
    expect(state.readinessLabel).toBe("setup: read-only");
    expect(state.bannerActions.map((action) => action.cliCommand)).toEqual([
      "status",
      "accounts",
      "--help",
    ]);
    expect(state.screenActions.map((action) => action.cliCommand)).toContain(
      "init --signer-only",
    );
  });

  test("getWelcomeState adds no-deposit banner hints for read-only setup", () => {
    const home = useWelcomeHome("pp-welcome-read-only-empty-");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ defaultChain: "mainnet", rpcOverrides: {} }),
      "utf8",
    );
    saveMnemonicToFile(MNEMONIC);

    const state = getWelcomeState();

    expect(state.kind).toBe("read_only_no_deposits");
    expect(state.bannerHint).toBe(
      "Browse pools now; add a signer key before depositing.",
    );
  });

  test("getWelcomeState adds no-deposit banner hints for ready setup", () => {
    const home = useWelcomeHome("pp-welcome-ready-empty-");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ defaultChain: "mainnet", rpcOverrides: {} }),
      "utf8",
    );
    saveMnemonicToFile(MNEMONIC);
    saveSignerKey(PRIVATE_KEY);

    const state = getWelcomeState();

    expect(state.kind).toBe("ready_no_deposits");
    expect(state.bannerHint).toBe(
      "Flow = deposit + privacy delay + private withdrawal.",
    );
    expect(state.bannerActions.find((action) =>
      action.cliCommand === "flow start 0.1 ETH",
    )?.description).toBe("deposit, then withdraw privately");
  });

  test("getWelcomeState promotes active workflows and pending ASP review follow-ups", () => {
    const home = useWelcomeHome("pp-welcome-workflow-active-");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ defaultChain: "mainnet", rpcOverrides: {} }),
      "utf8",
    );
    saveMnemonicToFile(MNEMONIC);
    saveSignerKey(PRIVATE_KEY);
    saveWorkflowSnapshot({
      schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
      workflowId: "wf-pending-review",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      phase: "awaiting_asp",
      chain: "mainnet",
      asset: "ETH",
      depositAmount: "100000000000000000",
      recipient: "0x1111111111111111111111111111111111111111",
      walletMode: "configured",
      walletAddress: "0x2222222222222222222222222222222222222222",
      poolAccountId: "PA-1",
      poolAccountNumber: 1,
      depositTxHash: "0x" + "aa".repeat(32),
      depositBlockNumber: "123",
    });

    const state = getWelcomeState();

    expect(state.kind).toBe("workflow_active");
    expect(state.readinessLabel).toBe("workflow: active");
    expect(state.screenActions.map((action) => action.cliCommand)).toEqual(
      expect.arrayContaining([
        "flow status latest",
        "flow watch latest",
        "accounts --pending-only",
      ]),
    );
    expect(getWelcomeReadinessLabel()).toBe("workflow: active");
  });

  test("getWelcomeState falls back safely when local readiness checks throw", () => {
    const home = useWelcomeHome("pp-welcome-fallback-");
    const accountsDir = join(home, "accounts");
    mkdirSync(accountsDir, { recursive: true });
    writeFileSync(join(accountsDir, `${CHAINS.mainnet.id}.json`), "{", "utf8");

    const state = getWelcomeState();

    expect(state.kind).toBe("fallback");
    expect(state.readinessLabel).toBe("setup: check status");
    expect(state.bannerActions.map((action) => action.cliCommand)).toEqual([
      "status",
      "guide",
      "--help",
    ]);
  });
});
