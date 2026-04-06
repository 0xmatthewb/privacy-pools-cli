import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import {
  renderAccounts,
  renderAccountsNoPools,
  type AccountsRenderData,
} from "../../src/output/accounts.ts";
import { renderHistory, renderHistoryNoPools } from "../../src/output/history.ts";
import { renderMigrationStatus } from "../../src/output/migrate.ts";
import { renderStatus } from "../../src/output/status.ts";
import { renderSyncComplete, renderSyncEmpty } from "../../src/output/sync.ts";
import { makeMode, captureOutput, parseCapturedJson } from "../helpers/output.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

const ACCOUNT_GROUPS: AccountsRenderData["groups"] = [
  {
    chain: "mainnet",
    chainId: 1,
    symbol: "ETH",
    poolAddress: "0x1111111111111111111111111111111111111111",
    decimals: 18,
    scope: 1n,
    tokenPrice: null,
    poolAccounts: [
      {
        paNumber: 1,
        paId: "PA-1",
        status: "approved",
        aspStatus: "approved",
        commitment: {
          hash: 501n,
          label: 601n,
          value: 1000000000000000000n,
        },
        label: 601n,
        value: 1000000000000000000n,
        blockNumber: 123n,
        txHash: "0x" + "aa".repeat(32),
      },
      {
        paNumber: 2,
        paId: "PA-2",
        status: "pending",
        aspStatus: "pending",
        commitment: {
          hash: 502n,
          label: 602n,
          value: 500000000000000000n,
        },
        label: 602n,
        value: 500000000000000000n,
        blockNumber: 124n,
        txHash: "0x" + "bb".repeat(32),
      },
    ],
  },
];

describe("read-only output renderers", () => {
  test("renderAccounts emits the default JSON envelope with poll nextActions", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "mainnet",
        groups: ACCOUNT_GROUPS,
        showDetails: false,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("mainnet");
    expect(json.accounts).toHaveLength(2);
    expect(json.balances).toEqual([
      expect.objectContaining({
        asset: "ETH",
        balance: "1500000000000000000",
      }),
    ]);
    expect(json.pendingCount).toBe(1);
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "accounts",
          when: "has_pending",
        }),
      ]),
    );
    expect(stderr).toBe("");
  });

  test("renderAccounts supports summary and pending-only JSON variants", () => {
    const summaryCtx = createOutputContext(makeMode({ isJson: true }));
    const pendingCtx = createOutputContext(makeMode({ isJson: true }));

    const summary = captureOutput(() =>
      renderAccounts(summaryCtx, {
        chain: "mainnet",
        groups: ACCOUNT_GROUPS,
        showDetails: false,
        showSummary: true,
        showPendingOnly: false,
      }),
    );
    const pending = captureOutput(() =>
      renderAccounts(pendingCtx, {
        chain: "mainnet",
        groups: ACCOUNT_GROUPS,
        showDetails: false,
        showSummary: false,
        showPendingOnly: true,
      }),
    );

    const summaryJson = parseCapturedJson(summary.stdout);
    const pendingJson = parseCapturedJson(pending.stdout);
    expect(summaryJson.approvedCount).toBe(1);
    expect(summaryJson.pendingCount).toBe(1);
    expect(pendingJson.accounts).toHaveLength(1);
    expect(pendingJson.accounts[0].poolAccountId).toBe("PA-2");
    expect(pendingJson.pendingCount).toBe(1);
  });

  test("renderAccountsNoPools handles empty JSON and human states", () => {
    const jsonCtx = createOutputContext(makeMode({ isJson: true }));
    const humanCtx = createOutputContext(makeMode());

    const jsonOutput = captureOutput(() =>
      renderAccountsNoPools(jsonCtx, {
        chain: "mainnet",
        warnings: [
          {
            chain: "mainnet",
            category: "ASP",
            message: "review data incomplete",
          },
        ],
      }),
    );
    const humanOutput = captureOutput(() =>
      renderAccountsNoPools(humanCtx, {
        chain: "mainnet",
        pendingOnly: true,
        warnings: [
          {
            chain: "mainnet",
            category: "ASP",
            message: "review data incomplete",
          },
        ],
      }),
    );

    expect(parseCapturedJson(jsonOutput.stdout)).toEqual(
      expect.objectContaining({
        success: true,
        chain: "mainnet",
        accounts: [],
        balances: [],
        pendingCount: 0,
      }),
    );
    expect(humanOutput.stderr).toContain("review data incomplete");
    expect(humanOutput.stderr).toContain("No pending Pool Accounts found");
    expect(humanOutput.stderr).toContain("without --pending-only to confirm approved, declined, or POA Needed results");
  });

  test("renderHistory and renderHistoryNoPools preserve JSON and human contracts", () => {
    const jsonCtx = createOutputContext(makeMode({ isJson: true }));
    const humanCtx = createOutputContext(makeMode());

    const historyJson = captureOutput(() =>
      renderHistory(jsonCtx, {
        chain: "mainnet",
        chainId: 1,
        currentBlock: 200n,
        avgBlockTimeSec: 12,
        explorerTxUrl: () => "https://etherscan.io/tx/demo",
        poolByAddress: new Map([
          ["0x1111111111111111111111111111111111111111", { pool: "0x1111111111111111111111111111111111111111", decimals: 18 }],
        ]),
        events: [
          {
            type: "ragequit",
            asset: "ETH",
            poolAddress: "0x1111111111111111111111111111111111111111",
            paNumber: 1,
            paId: "PA-1",
            value: 500000000000000000n,
            blockNumber: 150n,
            txHash: "0x" + "cc".repeat(32),
          },
        ],
      }),
    );
    const historyHuman = captureOutput(() =>
      renderHistoryNoPools(humanCtx, "mainnet"),
    );

    const json = parseCapturedJson(historyJson.stdout);
    expect(json.events).toEqual([
      expect.objectContaining({
        type: "ragequit",
        poolAccountId: "PA-1",
        explorerUrl: "https://etherscan.io/tx/demo",
      }),
    ]);
    expect(historyHuman.stderr).toContain("No pools found on mainnet.");
  });

  test("renderSyncComplete and renderSyncEmpty cover JSON and human branches", () => {
    const jsonCtx = createOutputContext(makeMode({ isJson: true }));
    const humanCtx = createOutputContext(makeMode());

    const jsonOutput = captureOutput(() =>
      renderSyncComplete(jsonCtx, {
        chain: "mainnet",
        syncedPools: 2,
        syncedSymbols: ["ETH", "USDC"],
        availablePoolAccounts: 4,
        previousAvailablePoolAccounts: 1,
      }),
    );
    const humanOutput = captureOutput(() =>
      renderSyncEmpty(humanCtx, "mainnet"),
    );

    expect(parseCapturedJson(jsonOutput.stdout)).toEqual(
      expect.objectContaining({
        success: true,
        chain: "mainnet",
        syncedPools: 2,
        availablePoolAccounts: 4,
      }),
    );
    expect(humanOutput.stderr).toContain("No pools found on mainnet.");
  });

  test("renderMigrationStatus emits JSON flags and human website guidance", () => {
    const jsonCtx = createOutputContext(makeMode({ isJson: true }));
    const humanCtx = createOutputContext(makeMode());

    const jsonOutput = captureOutput(() =>
      renderMigrationStatus(jsonCtx, {
        mode: "migration-status",
        chain: "all-mainnets",
        chains: ["mainnet", "arbitrum"],
        warnings: [
          {
            chain: "arbitrum",
            category: "RPC",
            message: "chain unavailable",
          },
        ],
        status: "review_incomplete",
        requiresMigration: true,
        requiresWebsiteRecovery: true,
        isFullyMigrated: false,
        readinessResolved: false,
        submissionSupported: false,
        requiredChainIds: [1],
        migratedChainIds: [],
        missingChainIds: [1],
        websiteRecoveryChainIds: [1],
        unresolvedChainIds: [42161],
        chainReadiness: [
          {
            chain: "mainnet",
            chainId: 1,
            status: "migration_required",
            candidateLegacyCommitments: 2,
            expectedLegacyCommitments: 1,
            migratedCommitments: 0,
            legacyMasterSeedNullifiedCount: 0,
            hasPostMigrationCommitments: false,
            isMigrated: false,
            legacySpendableCommitments: 1,
            upgradedSpendableCommitments: 0,
            declinedLegacyCommitments: 1,
            reviewStatusComplete: false,
            requiresMigration: true,
            requiresWebsiteRecovery: true,
            scopes: ["1"],
          },
        ],
      }),
    );
    const humanOutput = captureOutput(() =>
      renderMigrationStatus(humanCtx, {
        mode: "migration-status",
        chain: "mainnet",
        status: "review_incomplete",
        requiresMigration: true,
        requiresWebsiteRecovery: true,
        isFullyMigrated: false,
        readinessResolved: false,
        submissionSupported: false,
        requiredChainIds: [1],
        migratedChainIds: [],
        missingChainIds: [1],
        websiteRecoveryChainIds: [1],
        unresolvedChainIds: [1],
        chainReadiness: [
          {
            chain: "mainnet",
            chainId: 1,
            status: "review_incomplete",
            candidateLegacyCommitments: 2,
            expectedLegacyCommitments: 1,
            migratedCommitments: 0,
            legacyMasterSeedNullifiedCount: 0,
            hasPostMigrationCommitments: false,
            isMigrated: false,
            legacySpendableCommitments: 1,
            upgradedSpendableCommitments: 0,
            declinedLegacyCommitments: 1,
            reviewStatusComplete: false,
            requiresMigration: true,
            requiresWebsiteRecovery: true,
            scopes: ["1"],
          },
        ],
      }),
    );

    expect(parseCapturedJson(jsonOutput.stdout)).toEqual(
      expect.objectContaining({
        success: true,
        mode: "migration-status",
        status: "review_incomplete",
        requiresMigration: true,
        requiresWebsiteRecovery: true,
        readinessResolved: false,
        unresolvedChainIds: [42161],
      }),
    );
    expect(humanOutput.stderr).toContain("Migration Status");
    expect(humanOutput.stderr).toContain("Read-only check only");
    expect(humanOutput.stderr).toContain("Website-only action");
    expect(humanOutput.stderr).toContain("privacypools.com");
  });

  test("renderAccounts emits detailed human output for multi-chain groups and warnings", () => {
    const ctx = createOutputContext(makeMode(), true);

    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "all-mainnets",
        chains: ["mainnet", "optimism"],
        warnings: [
          {
            chain: "optimism",
            category: "RPC",
            message: "rpc unavailable",
          },
        ],
        groups: [
          ...ACCOUNT_GROUPS,
          {
            chain: "optimism",
            chainId: 10,
            symbol: "USDC",
            poolAddress: "0x2222222222222222222222222222222222222222",
            decimals: 6,
            scope: 2n,
            tokenPrice: 1,
            poolAccounts: [
              {
                paNumber: 3,
                paId: "PA-3",
                status: "declined",
                aspStatus: "declined",
                commitment: { hash: 503n, label: 603n, value: 25000000n },
                label: 603n,
                value: 25000000n,
                blockNumber: 130n,
                txHash: "0x" + "cc".repeat(32),
              },
              {
                paNumber: 4,
                paId: "PA-4",
                status: "poi_required",
                aspStatus: "poi_required",
                commitment: { hash: 504n, label: 604n, value: 12000000n },
                label: 604n,
                value: 12000000n,
                blockNumber: 131n,
                txHash: "0x" + "dd".repeat(32),
              },
            ],
          },
        ],
        showDetails: true,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(stderr).toContain("optimism (RPC): rpc unavailable");
    expect(stderr).toContain("My Pools across mainnet chains");
    expect(stderr).toContain("ETH Pool");
    expect(stderr).toContain("USDC Pool");
    expect(stderr).toContain("declined");
    expect(stderr).toContain("Proof of Association");
    expect(stderr).toContain("Next steps:");
  });

  test("renderAccounts supports CSV summary and detailed rows", () => {
    const ctx = createOutputContext(makeMode({ isCsv: true, format: "csv" }));

    const summary = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "mainnet",
        groups: ACCOUNT_GROUPS,
        showDetails: false,
        showSummary: true,
        showPendingOnly: false,
      }),
    );
    const detail = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "mainnet",
        groups: ACCOUNT_GROUPS,
        showDetails: true,
        showSummary: false,
        showPendingOnly: false,
      }),
    );

    expect(summary.stdout).toContain("Asset,Balance,USD,Pool Accounts,Pending,Approved");
    expect(summary.stdout).toContain("ETH,1500000000000000000");
    expect(detail.stdout).toContain("PA,Status,ASP,Asset,Value,Tx");
    expect(detail.stdout).toContain("PA-1,approved,approved,ETH,1 ETH");
    expect(detail.stderr).toBe("");
  });

  test("renderStatus human output includes health checks and unsigned-only guidance", () => {
    const ctx = createOutputContext(makeMode(), true);

    const { stderr } = captureOutput(() =>
      renderStatus(ctx, {
        configExists: true,
        configDir: "/tmp/privacy-pools",
        defaultChain: "mainnet",
        selectedChain: "sepolia",
        rpcUrl: "https://rpc.example",
        rpcIsCustom: true,
        recoveryPhraseSet: true,
        signerKeySet: false,
        signerKeyValid: false,
        signerAddress: null,
        entrypoint: "0x1111111111111111111111111111111111111111",
        aspHost: "https://asp.example",
        aspLive: true,
        rpcLive: true,
        rpcBlockNumber: 12345678n,
        healthChecksEnabled: { rpc: true, asp: true },
        accountFiles: [
          ["mainnet", 1],
          ["sepolia", 11155111],
        ],
      }),
    );

    expect(stderr).toContain("Privacy Pools CLI Status");
    expect(stderr).toContain("Wallet:");
    expect(stderr).toMatch(/Config:\s+\/tmp\/privacy-pools\/config\.json/);
    expect(stderr).toMatch(/Recovery phrase:\s+set/);
    expect(stderr).toMatch(/Signer key:\s+not set/);
    expect(stderr).toMatch(/ASP \(https:\/\/asp\.example\):\s+healthy/);
    expect(stderr).toMatch(/RPC:\s+connected/);
    expect(stderr).toContain("unsigned mode only");
    expect(stderr).toContain("accounts --chain sepolia");
  });

  test("renderStatus warns on invalid signer keys and mixed health-check results", () => {
    const ctx = createOutputContext(makeMode(), true);

    const { stderr } = captureOutput(() =>
      renderStatus(ctx, {
        configExists: true,
        configDir: "/tmp/privacy-pools",
        defaultChain: "mainnet",
        selectedChain: "mainnet",
        rpcUrl: "https://rpc.example",
        rpcIsCustom: false,
        recoveryPhraseSet: true,
        signerKeySet: true,
        signerKeyValid: false,
        signerAddress: null,
        entrypoint: "0x1111111111111111111111111111111111111111",
        aspHost: "https://asp.example",
        aspLive: false,
        rpcLive: true,
        rpcBlockNumber: 77n,
        healthChecksEnabled: { rpc: true, asp: true },
        accountFiles: [],
      }),
    );

    expect(stderr).toContain("is set but invalid");
    expect(stderr).toMatch(/ASP \(https:\/\/asp\.example\):\s+unreachable/);
    expect(stderr).toMatch(/RPC:\s+connected \(block 77\)/);
  });

  test("renderAccounts human summary covers spent and exited-only groups", () => {
    const ctx = createOutputContext(makeMode());

    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "mainnet",
        groups: [
          {
            chain: "mainnet",
            chainId: 1,
            symbol: "ETH",
            poolAddress: "0x3333333333333333333333333333333333333333",
            decimals: 18,
            scope: 3n,
            tokenPrice: null,
            poolAccounts: [
              {
                paNumber: 5,
                paId: "PA-5",
                status: "spent",
                aspStatus: "approved",
                commitment: { hash: 505n, label: 605n, value: 0n },
                label: 605n,
                value: 0n,
                blockNumber: 132n,
                txHash: "0x" + "ee".repeat(32),
              },
              {
                paNumber: 6,
                paId: "PA-6",
                status: "exited",
                aspStatus: "approved",
                commitment: { hash: 506n, label: 606n, value: 0n },
                label: 606n,
                value: 0n,
                blockNumber: 133n,
                txHash: "0x" + "ff".repeat(32),
              },
            ],
          },
        ],
        showDetails: false,
        showSummary: true,
        showPendingOnly: false,
      }),
    );

    expect(stderr).toContain("Pool Account summary on mainnet");
    expect(stderr).toContain("Spent");
    expect(stderr).toContain("Exited");
    expect(stderr).toContain("No Pool Accounts with remaining balance found");
  });

  test("renderAccounts pending-only mode groups multi-chain output and explains the disappearing-state behavior", () => {
    const ctx = createOutputContext(makeMode());

    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "all-mainnets",
        allChains: true,
        chains: ["mainnet", "arbitrum"],
        groups: [
          {
            chain: "mainnet",
            chainId: 1,
            symbol: "ETH",
            poolAddress: "0x4444444444444444444444444444444444444444",
            decimals: 18,
            scope: 4n,
            tokenPrice: null,
            poolAccounts: [
              {
                paNumber: 7,
                paId: "PA-7",
                status: "pending",
                aspStatus: "pending",
                commitment: { hash: 507n, label: 607n, value: 100000000000000000n },
                label: 607n,
                value: 100000000000000000n,
                blockNumber: 140n,
                txHash: "0x" + "12".repeat(32),
              },
            ],
          },
          {
            chain: "mainnet",
            chainId: 1,
            symbol: "USDC",
            poolAddress: "0x5555555555555555555555555555555555555555",
            decimals: 6,
            scope: 5n,
            tokenPrice: 1,
            poolAccounts: [
              {
                paNumber: 8,
                paId: "PA-8",
                status: "pending",
                aspStatus: "pending",
                commitment: { hash: 508n, label: 608n, value: 25000000n },
                label: 608n,
                value: 25000000n,
                blockNumber: 141n,
                txHash: "0x" + "13".repeat(32),
              },
            ],
          },
        ],
        showDetails: false,
        showSummary: false,
        showPendingOnly: true,
      }),
    );

    expect(stderr).toContain("Pending Pool Accounts across all chains");
    expect(stderr).toContain("mainnet:");
    expect(stderr).toContain("ETH Pool");
    expect(stderr).toContain("USDC Pool");
    expect(stderr).toContain("PA IDs are chain-local");
    expect(stderr).toContain("Pending-only mode hides final states once review completes");
  });
});
