import { formatUnits, type Address } from "viem";
import { POA_PORTAL_URL } from "../../config/chains.js";
import {
  createNextAction,
} from "../../output/common.js";
import type {
  RelayedWithdrawalRemainderGuidance,
  WithdrawUiWarning,
} from "../../output/withdraw.js";
import type {
  NextAction,
  RelayerQuoteResponse,
} from "../../types.js";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "../../utils/approval-timing.js";
import { buildPrivacyNonRoundAmountWarning } from "../../utils/amount-privacy.js";
import { CLIError } from "../../utils/errors.js";
import {
  formatAmount,
  formatBPS,
} from "../../utils/format.js";

type WithdrawReviewStatus = "pending" | "poa_required" | "declined" | "unknown";

interface ApprovalResolutionHintParams {
  chainName: string;
  assetSymbol: string;
  poolAccountId?: string;
  status?: WithdrawReviewStatus;
}

interface RelayedWithdrawalRemainderAdvisoryParams {
  remainingBalance: bigint;
  minWithdrawAmount: bigint;
  poolAccountId: string;
  assetSymbol: string;
  decimals: number;
  poolAccountValue?: bigint;
  chainName?: string;
  recipient?: Address;
}

interface ValidatedRelayerQuoteForWithdrawal {
  quoteFeeBPS: bigint;
  expirationMs: number;
}

interface RelayerQuoteRecoveryContext extends Record<string, unknown> {
  amountInput?: string;
  amount?: string | bigint;
  assetInput?: string;
  asset?: string;
  recipient?: string;
  recipientAddress?: string;
  chain?: string;
  chainName?: string;
}

interface RefreshExpiredRelayerQuoteForWithdrawalParams {
  fetchQuote: () => Promise<RelayerQuoteResponse>;
  maxRelayFeeBPS: bigint | string;
  recoveryContext?: RelayerQuoteRecoveryContext;
  nowMs?: () => number;
  maxAttempts?: number;
  onRetry?: (attempt: number, maxAttempts: number) => void;
}

interface RefreshedRelayerQuoteForWithdrawal
  extends ValidatedRelayerQuoteForWithdrawal {
  quote: RelayerQuoteResponse;
  attempts: number;
}

export function relayerHostLabel(relayerUrl: string | undefined): string | null {
  if (!relayerUrl) return null;
  try {
    return new URL(relayerUrl).host;
  } catch {
    return relayerUrl;
  }
}

export function getSuspiciousTestnetMinWithdrawFloor(decimals: number): bigint {
  return decimals >= 6 ? 10n ** BigInt(decimals - 6) : 1n;
}

export function buildWithdrawQuoteWarnings(params: {
  chainIsTestnet: boolean;
  assetSymbol: string;
  amount?: bigint;
  minWithdrawAmount: bigint;
  decimals: number;
}): WithdrawUiWarning[] {
  const warnings: WithdrawUiWarning[] = [];
  const privacyWarning = params.amount === undefined
    ? null
    : buildPrivacyNonRoundAmountWarning({
      amount: params.amount,
      decimals: params.decimals,
      symbol: params.assetSymbol,
    });
  if (privacyWarning) {
    warnings.push(privacyWarning);
  }

  const friendlyFloor = getSuspiciousTestnetMinWithdrawFloor(params.decimals);
  if (params.chainIsTestnet && params.minWithdrawAmount < friendlyFloor) {
    warnings.push({
      code: "TESTNET_MIN_WITHDRAW_AMOUNT_UNUSUALLY_LOW",
      category: "testnet",
      message:
        `This is a testnet quote. The relayer minimum is below ${formatAmount(friendlyFloor, params.decimals, params.assetSymbol)}, ` +
        "so treat it as a testnet convenience rather than a production-like floor.",
    });
  }

  return warnings;
}

export function buildDirectRecipientMismatchNextActions(params: {
  amountInput: string;
  assetInput: string | null;
  chainName: string;
  recipientAddress: Address;
  signerAddress: Address;
}): NextAction[] {
  const actions: NextAction[] = [];
  if (params.assetInput) {
    actions.push(
      createNextAction(
        "withdraw",
        "Use the default relayed mode to withdraw to a different recipient address.",
        "after_dry_run",
        {
          args: [params.amountInput, params.assetInput],
          options: {
            agent: true,
            chain: params.chainName,
            to: params.recipientAddress,
          },
        },
      ),
    );
    actions.push(
      createNextAction(
        "withdraw",
        "Retry direct mode to withdraw publicly to the signer address instead of the requested recipient.",
        "after_dry_run",
        {
          args: [params.amountInput, params.assetInput],
          options: {
            agent: true,
            chain: params.chainName,
            direct: true,
            confirmDirectWithdraw: true,
          },
        },
      ),
    );
    return actions;
  }

  actions.push(
    createNextAction(
      "withdraw",
      "Use the default relayed mode to withdraw to a different recipient address.",
      "after_dry_run",
      {
        options: {
          agent: true,
          chain: params.chainName,
          to: params.recipientAddress,
        },
        runnable: false,
        parameters: [{ name: "asset", type: "asset", required: true }],
      },
    ),
  );
  actions.push(
      createNextAction(
        "withdraw",
      "Retry direct mode to withdraw publicly to the signer address instead of the requested recipient.",
      "after_dry_run",
      {
        options: {
          agent: true,
          chain: params.chainName,
          direct: true,
          confirmDirectWithdraw: true,
        },
        runnable: false,
        parameters: [{ name: "asset", type: "asset", required: true }],
      },
    ),
  );
  return actions;
}

export function buildRemainderBelowMinNextActions(params: {
  chainName: string;
  asset: string;
  decimals: number;
  recipient: Address;
  poolAccountId: string;
  poolAccountValue: bigint;
  minWithdrawAmount: bigint;
  signerAddress: Address | null;
}): NextAction[] {
  const actions: NextAction[] = [
    createNextAction(
      "withdraw",
      "Withdraw the full Pool Account balance so no stranded remainder is left behind.",
      "after_quote",
      {
        args: [params.asset],
        options: {
          agent: true,
          chain: params.chainName,
          all: true,
          to: params.recipient,
          poolAccount: params.poolAccountId,
        },
      },
    ),
    createNextAction(
      "ragequit",
      "Use the public recovery path instead of leaving a remainder below the relayer minimum.",
      "after_quote",
      {
        args: [params.asset],
        options: {
          agent: true,
          chain: params.chainName,
          poolAccount: params.poolAccountId,
          confirmRagequit: true,
        },
      },
    ),
  ];

  const maxSafeRelayedAmount = params.poolAccountValue - params.minWithdrawAmount;
  if (maxSafeRelayedAmount >= params.minWithdrawAmount) {
    actions.splice(
      1,
      0,
      createNextAction(
        "withdraw",
        "Withdraw less so the remaining balance stays privately withdrawable.",
        "after_quote",
        {
          args: [formatUnits(maxSafeRelayedAmount, params.decimals), params.asset],
          options: {
            agent: true,
            chain: params.chainName,
            to: params.recipient,
            poolAccount: params.poolAccountId,
          },
        },
      ),
    );
  }

  if (
    params.signerAddress &&
    params.recipient.toLowerCase() === params.signerAddress.toLowerCase()
  ) {
    actions.push(
      createNextAction(
        "withdraw",
        "Direct mode is also valid here because the recipient already matches the signer address.",
        "after_quote",
        {
          args: [formatUnits(params.poolAccountValue, params.decimals), params.asset],
          options: {
            agent: true,
            chain: params.chainName,
            direct: true,
            confirmDirectWithdraw: true,
          },
        },
      ),
    );
  }

  return actions;
}

export function formatApprovalResolutionHint(
  params: ApprovalResolutionHintParams,
): string {
  const { chainName, assetSymbol, poolAccountId, status } = params;
  const ragequitSelector = poolAccountId ?? "<PA-#>";
  const ragequitCmd = `privacy-pools ragequit ${assetSymbol} --chain ${chainName} --pool-account ${ragequitSelector}`;

  switch (status) {
    case "pending":
      return `ASP approval is required for both relayed and direct withdrawals. Run 'privacy-pools accounts --chain ${chainName}' to check aspStatus. ${DEPOSIT_APPROVAL_TIMELINE_COPY}`;
    case "poa_required":
      return `This Pool Account needs Proof of Association before it can use withdraw. Complete the PoA flow at ${POA_PORTAL_URL}, then re-run 'privacy-pools accounts --chain ${chainName}' to confirm aspStatus. If you prefer a public recovery path instead, use '${ragequitCmd}'.`;
    case "declined":
      return `This Pool Account was declined by the ASP. Private withdraw, including --direct, is unavailable. Ragequit is available to publicly recover funds to the original deposit address: '${ragequitCmd}'.`;
    default:
      return `Run 'privacy-pools accounts --chain ${chainName}' to inspect aspStatus. Pending deposits need more time, POA-needed deposits need Proof of Association at ${POA_PORTAL_URL}, and declined deposits can be recovered publicly via ragequit: '${ragequitCmd}'.`;
  }
}

export function getRelayedWithdrawalRemainderAdvisory(
  params: RelayedWithdrawalRemainderAdvisoryParams,
): RelayedWithdrawalRemainderGuidance | null {
  const {
    remainingBalance,
    minWithdrawAmount,
    poolAccountId,
    assetSymbol,
    decimals,
    poolAccountValue,
    chainName,
    recipient,
  } = params;
  if (remainingBalance <= 0n || remainingBalance >= minWithdrawAmount) {
    return null;
  }

  const chainArg = chainName ? ` --chain ${chainName}` : "";
  const recipientArg = recipient ? ` --to ${recipient}` : " --to <address>";
  const choices: string[] = [];
  const maxSafeRelayedAmount = poolAccountValue !== undefined
    ? poolAccountValue - minWithdrawAmount
    : null;

  if (
    recipient &&
    chainName &&
    maxSafeRelayedAmount !== null &&
    maxSafeRelayedAmount >= minWithdrawAmount
  ) {
    choices.push(
      `Withdraw less: privacy-pools withdraw ${formatUnits(maxSafeRelayedAmount, decimals)} ${assetSymbol}${chainArg}${recipientArg} --pool-account ${poolAccountId}`,
    );
  } else if (
    maxSafeRelayedAmount !== null &&
    maxSafeRelayedAmount >= minWithdrawAmount
  ) {
    choices.push(
      `Withdraw less and leave at least ${formatAmount(minWithdrawAmount, decimals, assetSymbol)} in ${poolAccountId}.`,
    );
  }

  if (chainName && recipient) {
    choices.push(
      `Use max: privacy-pools withdraw --all ${assetSymbol}${chainArg}${recipientArg} --pool-account ${poolAccountId}`,
    );
    choices.push(
      `Continue now, then recover the leftover publicly later: privacy-pools ragequit ${assetSymbol}${chainArg} --pool-account ${poolAccountId} --confirm-ragequit`,
    );
  } else {
    choices.push(
      `Use max / --all to empty ${poolAccountId} in one relayed withdrawal.`,
    );
    choices.push(
      `Continue now and ragequit the leftover later if you intentionally accept public recovery for the remainder.`,
    );
  }

  return {
    summary:
      `${poolAccountId} would keep ${formatAmount(remainingBalance, decimals, assetSymbol)}, ` +
      `which is below the relayer minimum (${formatAmount(minWithdrawAmount, decimals, assetSymbol)}).`,
    choices,
  };
}

export function formatRelayedWithdrawalRemainderHint(
  guidance: RelayedWithdrawalRemainderGuidance,
): string {
  return [
    guidance.summary,
    "You can: (1) withdraw less, (2) withdraw the full balance with --all, or (3) plan a public recovery later via ragequit (compromises privacy for the remainder).",
    ...guidance.choices.map((choice) => `- ${choice}`),
  ].join("\n");
}

export function normalizeRelayerQuoteExpirationMs(expiration: number): number {
  return expiration < 1e12 ? expiration * 1000 : expiration;
}

export function validateRelayerQuoteForWithdrawal(
  quote: Pick<RelayerQuoteResponse, "feeBPS" | "feeCommitment">,
  maxRelayFeeBPS: bigint | string,
  recoveryContext: RelayerQuoteRecoveryContext = {},
): ValidatedRelayerQuoteForWithdrawal {
  if (!quote.feeCommitment) {
    throw new CLIError(
      "Relayer quote is missing required fee details.",
      "RELAYER",
      "The relayer may not support this asset/chain combination.",
    );
  }

  let quoteFeeBPS: bigint;
  try {
    quoteFeeBPS = BigInt(quote.feeBPS);
  } catch {
    throw new CLIError(
      "Relayer returned malformed feeBPS (expected integer string).",
      "RELAYER",
      "Request a fresh quote and retry.",
    );
  }

  const maxFeeBPS = typeof maxRelayFeeBPS === "bigint"
    ? maxRelayFeeBPS
    : BigInt(maxRelayFeeBPS);
  if (quoteFeeBPS > maxFeeBPS) {
    throw new CLIError(
      `Quoted relay fee (${formatBPS(quote.feeBPS)}) exceeds onchain maximum (${formatBPS(maxFeeBPS.toString())}).`,
      "RELAYER",
      "Try again later when fees are lower. If privacy is not a concern, --direct withdraws without a relayer but publicly links your deposit and withdrawal addresses.",
      "RELAYER_FEE_EXCEEDS_MAX",
      true,
      undefined,
      recoveryContext,
    );
  }

  return {
    quoteFeeBPS,
    expirationMs: normalizeRelayerQuoteExpirationMs(
      quote.feeCommitment.expiration,
    ),
  };
}

export async function refreshExpiredRelayerQuoteForWithdrawal(
  params: RefreshExpiredRelayerQuoteForWithdrawalParams,
): Promise<RefreshedRelayerQuoteForWithdrawal> {
  const nowMs = params.nowMs ?? Date.now;
  const maxAttempts = params.maxAttempts ?? 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1 && params.onRetry) {
      params.onRetry(attempt, maxAttempts);
    }
    const quote = await params.fetchQuote();
    const { quoteFeeBPS, expirationMs } = validateRelayerQuoteForWithdrawal(
      quote,
      params.maxRelayFeeBPS,
      params.recoveryContext,
    );
    if (nowMs() <= expirationMs) {
      return {
        quote,
        quoteFeeBPS,
        expirationMs,
        attempts: attempt,
      };
    }
  }

  throw new CLIError(
    "Relayer returned stale/expired quotes repeatedly.",
    "RELAYER",
    "Wait a moment and retry, or switch to another relayer.",
  );
}
