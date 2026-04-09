import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { displayDecimals, formatAmount, formatUsdValue } from "./format.js";
import {
  amount,
  chainName,
  poolAsset,
  statusFailed,
  statusHealthy,
  statusPending,
} from "./theme.js";
import { getOutputWidthClass, inlineSeparator, supportsUnicodeOutput } from "./terminal.js";

export type ConfirmationSeverity = "standard" | "high_stakes";

export const HIGH_STAKES_WITHDRAWAL_USD_THRESHOLD = 1000;

function joinPromptFacts(facts: string[]): string {
  const nonEmpty = facts.filter((value) => value.trim().length > 0);
  if (nonEmpty.length === 0) {
    return "";
  }

  const widthClass = getOutputWidthClass();
  const limit = widthClass === "narrow" ? 2 : widthClass === "compact" ? 3 : 4;
  return nonEmpty.slice(0, limit).join(chalk.dim(` ${inlineSeparator().trim()} `));
}

function renderStatusFact(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (
    normalized.includes("approved") ||
    normalized.includes("ready") ||
    normalized.includes("healthy")
  ) {
    return statusHealthy(status);
  }
  if (
    normalized.includes("pending") ||
    normalized.includes("review") ||
    normalized.includes("waiting")
  ) {
    return statusPending(status);
  }
  if (
    normalized.includes("declined") ||
    normalized.includes("blocked") ||
    normalized.includes("recovery") ||
    normalized.includes("public")
  ) {
    return statusFailed(status);
  }
  return chalk.dim(status);
}

export function formatPoolPromptChoice(params: {
  symbol: string;
  chain: string;
  minimumDepositAmount?: bigint;
  decimals: number;
  totalInPoolValue?: bigint;
  tokenPrice?: number | null;
}): string {
  const liquidity = params.totalInPoolValue
    ? amount(
        formatAmount(
          params.totalInPoolValue,
          params.decimals,
          params.symbol,
          displayDecimals(params.decimals),
        ),
      )
    : "";
  const minDeposit = params.minimumDepositAmount !== undefined
    ? amount(
        `min ${formatAmount(
          params.minimumDepositAmount,
          params.decimals,
          params.symbol,
          displayDecimals(params.decimals),
        )}`,
      )
    : "";
  const facts = [
    chainName(params.chain),
    liquidity ? `TVL ${liquidity}` : "",
    minDeposit,
    params.tokenPrice !== null && params.tokenPrice !== undefined
      ? chalk.dim(`$${Math.round(params.tokenPrice).toLocaleString("en-US")}/token`)
      : "",
  ];

  const metadata = joinPromptFacts(facts);
  return metadata.length > 0
    ? `${poolAsset(params.symbol)}  ${chalk.dim(supportsUnicodeOutput() ? "·" : "-")}  ${metadata}`
    : poolAsset(params.symbol);
}

export function formatPoolAccountPromptChoice(params: {
  poolAccountId: string;
  balance: bigint;
  decimals: number;
  symbol: string;
  status: string;
  chain?: string;
  usdValue?: string | null;
}): string {
  const facts = [
    amount(
      formatAmount(
        params.balance,
        params.decimals,
        params.symbol,
        displayDecimals(params.decimals),
      ),
    ),
    params.usdValue && params.usdValue !== "-"
      ? chalk.dim(params.usdValue)
      : "",
    renderStatusFact(params.status),
    params.chain ? chainName(params.chain) : "",
  ];
  const metadata = joinPromptFacts(facts);
  return metadata.length > 0
    ? `${params.poolAccountId}  ${chalk.dim(supportsUnicodeOutput() ? "·" : "-")}  ${metadata}`
    : params.poolAccountId;
}

export function isHighStakesWithdrawal(params: {
  amount: bigint;
  decimals: number;
  balance: bigint;
  tokenPrice?: number | null;
  fullBalance: boolean;
  direct?: boolean;
}): boolean {
  if (params.fullBalance || params.direct) {
    return true;
  }

  const usdValue = formatUsdValue(
    params.amount,
    params.decimals,
    params.tokenPrice ?? null,
  );
  if (usdValue === "-") {
    return false;
  }

  const parsed = Number(usdValue.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed >= HIGH_STAKES_WITHDRAWAL_USD_THRESHOLD;
}

export async function confirmActionWithSeverity(params: {
  severity: ConfirmationSeverity;
  standardMessage: string;
  highStakesToken: string;
  highStakesWarning: string;
  confirm: (options: { message: string; default?: boolean }) => Promise<boolean>;
}): Promise<boolean> {
  if (params.severity === "standard") {
    return params.confirm({
      message: params.standardMessage,
      default: true,
    });
  }

  process.stderr.write(`${statusFailed(params.highStakesWarning)}\n`);
  const typed = await input({
    message: `Type "${params.highStakesToken}" to confirm:`,
  });
  return typed.trim() === params.highStakesToken;
}
