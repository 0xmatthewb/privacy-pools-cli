import {
  createOutputContext,
  renderAccounts,
  renderAccountsNoPools,
  renderDepositDryRun,
  renderDepositSuccess,
  renderRagequitDryRun,
  renderRagequitSuccess,
  renderUpgradeResult,
  renderWithdrawDryRun,
  renderWithdrawQuote,
  renderWithdrawSuccess,
} from "../../src/output/mod.ts";

const HUMAN_MODE = {
  isAgent: false,
  isJson: false,
  isCsv: false,
  isQuiet: false,
  format: "table",
  skipPrompts: false,
};

const CONTEXT = createOutputContext(HUMAN_MODE);
const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const TEST_DEPOSIT_ADDRESS = "0x000000000000000000000000000000000000beef";
const SEPOLIA_CHAIN_ID = 11155111;

function makePoolAccount({
  number,
  status,
  aspStatus = status,
  value,
  hash,
  label,
  txHash,
  blockNumber,
}) {
  return {
    paNumber: number,
    paId: `PA-${number}`,
    status,
    aspStatus,
    commitment: {
      hash,
      label,
    },
    label,
    value,
    blockNumber,
    txHash,
  };
}

const POPULATED_GROUPS = [
  {
    chain: "sepolia",
    chainId: SEPOLIA_CHAIN_ID,
    symbol: "ETH",
    poolAddress: "0x1111111111111111111111111111111111111111",
    decimals: 18,
    scope: 1n,
    tokenPrice: 3200,
    poolAccounts: [
      makePoolAccount({
        number: 1,
        status: "approved",
        aspStatus: "approved",
        value: 800000000000000000n,
        hash: 101n,
        label: 9001n,
        txHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        blockNumber: 201n,
      }),
      makePoolAccount({
        number: 2,
        status: "pending",
        aspStatus: "pending",
        value: 400000000000000000n,
        hash: 102n,
        label: 9002n,
        txHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        blockNumber: 202n,
      }),
      makePoolAccount({
        number: 3,
        status: "poi_required",
        aspStatus: "poi_required",
        value: 200000000000000000n,
        hash: 103n,
        label: 9003n,
        txHash:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        blockNumber: 203n,
      }),
    ],
  },
  {
    chain: "sepolia",
    chainId: SEPOLIA_CHAIN_ID,
    symbol: "USDC",
    poolAddress: "0x2222222222222222222222222222222222222222",
    decimals: 6,
    scope: 2n,
    tokenPrice: 1,
    poolAccounts: [
      makePoolAccount({
        number: 4,
        status: "approved",
        aspStatus: "approved",
        value: 125000000n,
        hash: 201n,
        label: 9101n,
        txHash:
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        blockNumber: 204n,
      }),
      makePoolAccount({
        number: 5,
        status: "declined",
        aspStatus: "declined",
        value: 50000000n,
        hash: 202n,
        label: 9102n,
        txHash:
          "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        blockNumber: 205n,
      }),
    ],
  },
];

export const RENDERER_FIXTURE_CASE_IDS = [
  "accounts-empty",
  "accounts-pending-empty",
  "accounts-populated",
  "deposit-dry-run",
  "deposit-success",
  "withdraw-quote",
  "withdraw-dry-run-relayed",
  "withdraw-success-relayed",
  "withdraw-dry-run-direct",
  "withdraw-success-direct",
  "ragequit-dry-run",
  "ragequit-success",
  "upgrade-check",
];

export function renderPreviewFixture(caseId) {
  process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? "1";

  switch (caseId) {
    case "accounts-empty":
      renderAccountsNoPools(CONTEXT, {
        chain: "sepolia",
        summary: false,
        pendingOnly: false,
      });
      return;
    case "accounts-pending-empty":
      renderAccountsNoPools(CONTEXT, {
        chain: "sepolia",
        summary: false,
        pendingOnly: true,
      });
      return;
    case "accounts-populated":
      renderAccounts(CONTEXT, {
        chain: "sepolia",
        groups: POPULATED_GROUPS,
        showDetails: true,
        showSummary: false,
        showPendingOnly: false,
      });
      return;
    case "deposit-dry-run":
      renderDepositDryRun(CONTEXT, {
        chain: "sepolia",
        asset: "ETH",
        amount: 100000000000000000n,
        decimals: 18,
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        precommitment: 777n,
        balanceSufficient: true,
      });
      return;
    case "deposit-success":
      renderDepositSuccess(CONTEXT, {
        txHash:
          "0x1234123412341234123412341234123412341234123412341234123412341234",
        amount: 100000000000000000n,
        committedValue: 99500000000000000n,
        asset: "ETH",
        chain: "sepolia",
        decimals: 18,
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        poolAddress: "0x1111111111111111111111111111111111111111",
        scope: 1n,
        label: 999n,
        blockNumber: 301n,
        explorerUrl: "https://sepolia.etherscan.io/tx/0x1234",
        chainOverridden: true,
      });
      return;
    case "withdraw-quote":
      renderWithdrawQuote(CONTEXT, {
        chain: "sepolia",
        asset: "USDC",
        amount: 150000000n,
        decimals: 6,
        recipient: TEST_RECIPIENT,
        minWithdrawAmount: "10000000",
        baseFeeBPS: "30",
        quoteFeeBPS: "35",
        feeCommitmentPresent: true,
        quoteExpiresAt: "2026-04-07T18:42:00.000Z",
        tokenPrice: 1,
        extraGas: true,
        relayTxCost: {
          gas: "210000",
          eth: "1200000000000000",
        },
        extraGasFundAmount: {
          gas: "0",
          eth: "1500000000000000",
        },
        extraGasTxCost: {
          gas: "25000",
          eth: "500000000000000",
        },
        chainOverridden: true,
      });
      return;
    case "withdraw-dry-run-relayed":
      renderWithdrawDryRun(CONTEXT, {
        withdrawMode: "relayed",
        amount: 50000000n,
        asset: "USDC",
        chain: "sepolia",
        decimals: 6,
        recipient: TEST_RECIPIENT,
        poolAccountNumber: 4,
        poolAccountId: "PA-4",
        selectedCommitmentLabel: 9101n,
        selectedCommitmentValue: 125000000n,
        proofPublicSignals: 8,
        feeBPS: "35",
        quoteExpiresAt: "2026-04-07T18:42:00.000Z",
        extraGas: true,
        anonymitySet: { eligible: 82, total: 130, percentage: 63.1 },
      });
      return;
    case "withdraw-success-relayed":
      renderWithdrawSuccess(CONTEXT, {
        withdrawMode: "relayed",
        txHash:
          "0x9999999999999999999999999999999999999999999999999999999999999999",
        blockNumber: 404n,
        amount: 50000000n,
        recipient: TEST_RECIPIENT,
        asset: "USDC",
        chain: "sepolia",
        decimals: 6,
        poolAccountNumber: 4,
        poolAccountId: "PA-4",
        poolAddress: "0x2222222222222222222222222222222222222222",
        scope: 2n,
        explorerUrl: "https://sepolia.etherscan.io/tx/0x9999",
        feeBPS: "35",
        extraGas: true,
        remainingBalance: 75000000n,
        tokenPrice: 1,
        anonymitySet: { eligible: 82, total: 130, percentage: 63.1 },
      });
      return;
    case "withdraw-dry-run-direct":
      renderWithdrawDryRun(CONTEXT, {
        withdrawMode: "direct",
        amount: 300000000000000000n,
        asset: "ETH",
        chain: "sepolia",
        decimals: 18,
        recipient: TEST_RECIPIENT,
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        selectedCommitmentLabel: 9001n,
        selectedCommitmentValue: 800000000000000000n,
        proofPublicSignals: 8,
      });
      return;
    case "withdraw-success-direct":
      renderWithdrawSuccess(CONTEXT, {
        withdrawMode: "direct",
        txHash:
          "0x7777777777777777777777777777777777777777777777777777777777777777",
        blockNumber: 405n,
        amount: 300000000000000000n,
        recipient: TEST_RECIPIENT,
        asset: "ETH",
        chain: "sepolia",
        decimals: 18,
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        poolAddress: "0x1111111111111111111111111111111111111111",
        scope: 1n,
        explorerUrl: "https://sepolia.etherscan.io/tx/0x7777",
        remainingBalance: 500000000000000000n,
        tokenPrice: 3200,
      });
      return;
    case "ragequit-dry-run":
      renderRagequitDryRun(CONTEXT, {
        chain: "sepolia",
        asset: "ETH",
        amount: 400000000000000000n,
        decimals: 18,
        destinationAddress: TEST_DEPOSIT_ADDRESS,
        poolAccountNumber: 3,
        poolAccountId: "PA-3",
        selectedCommitmentLabel: 9003n,
        selectedCommitmentValue: 400000000000000000n,
        proofPublicSignals: 8,
      });
      return;
    case "ragequit-success":
      renderRagequitSuccess(CONTEXT, {
        txHash:
          "0x6666666666666666666666666666666666666666666666666666666666666666",
        amount: 400000000000000000n,
        asset: "ETH",
        chain: "sepolia",
        decimals: 18,
        poolAccountNumber: 3,
        poolAccountId: "PA-3",
        poolAddress: "0x1111111111111111111111111111111111111111",
        scope: 1n,
        blockNumber: 406n,
        explorerUrl: "https://sepolia.etherscan.io/tx/0x6666",
        destinationAddress: TEST_DEPOSIT_ADDRESS,
      });
      return;
    case "upgrade-check":
      renderUpgradeResult(CONTEXT, {
        mode: "upgrade",
        status: "manual",
        currentVersion: "1.7.0",
        latestVersion: "1.8.0",
        updateAvailable: true,
        performed: false,
        command: "npm install -g privacy-pools-cli@1.8.0",
        installContext: {
          kind: "source_checkout",
          supportedAutoRun: false,
          reason:
            "This CLI is running from a source checkout. Automatic upgrade is unsupported there, so install the published CLI separately with the npm command below.",
        },
        installedVersion: null,
      });
      return;
    default:
      throw new Error(`Unknown preview fixture case: ${caseId}`);
  }
}
