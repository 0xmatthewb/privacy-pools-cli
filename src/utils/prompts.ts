import chalk from "chalk";
import { displayDecimals, formatAmount, formatUsdValue } from "./format.js";
import { ensurePromptInteractionAvailable } from "./prompt-cancellation.js";
import {
  amount,
  chainName,
  faint,
  muted,
  poolAsset,
  statusFailed,
  statusHealthy,
  statusPending,
} from "./theme.js";
import {
  getOutputWidthClass,
  inlineSeparator,
  padDisplay,
  supportsUnicodeOutput,
  visibleWidth,
  wrapDisplayText,
} from "./terminal.js";

export type ConfirmationSeverity = "standard" | "high_stakes";
export type PromptModule = Pick<
  typeof import("@inquirer/prompts"),
  "confirm" | "input" | "password" | "select"
>;
export type PromptConfirm = PromptModule["confirm"];
export type PromptInput = PromptModule["input"];
export type PromptPassword = PromptModule["password"];
export type PromptSelect = PromptModule["select"];

export const HIGH_STAKES_WITHDRAWAL_USD_THRESHOLD = 1000;
export const CONFIRMATION_TOKENS = {
  deposit: "DEPOSIT",
  withdraw: "WITHDRAW",
  directWithdrawal: "DIRECT",
  recipient: "RECIPIENT",
  ragequit: "RAGEQUIT",
  flow: "FLOW",
  proceed: "PROCEED",
} as const;

export function confirmationTokenMismatchMessage(token: string): string {
  return `Confirmation token did not match. Expected '${token}' (exact case).`;
}

export function formatSeverityWarningBlock(warning: string, token: string): string {
  const useUnicode = supportsUnicodeOutput();
  const topLeft = useUnicode ? "╭" : "+";
  const topRight = useUnicode ? "╮" : "+";
  const bottomLeft = useUnicode ? "╰" : "+";
  const bottomRight = useUnicode ? "╯" : "+";
  const horizontal = useUnicode ? "─" : "-";
  const vertical = useUnicode ? "│" : "|";
  const title = " High-risk confirmation ";
  const tokenBadge = chalk.bold.bgRed(` ${token} `);
  const maxWidth = 76;
  const bodyLines = [
    ...wrapDisplayText(warning, maxWidth),
    "",
    `Type ${tokenBadge} exactly to continue.`,
  ];
  const contentWidth = Math.max(
    32,
    visibleWidth(title) + 2,
    ...bodyLines.map((line) => visibleWidth(line)),
  );
  const titleRemainder = Math.max(0, contentWidth - visibleWidth(title));
  const top =
    `${topLeft}${horizontal}${chalk.bold(title)}${horizontal.repeat(titleRemainder + 1)}${topRight}`;
  const bottom = `${bottomLeft}${horizontal.repeat(contentWidth + 2)}${bottomRight}`;
  const body = bodyLines
    .map((line) => `${vertical} ${padDisplay(line, contentWidth)} ${vertical}`)
    .join("\n");
  return `\n${statusFailed(top)}\n${body}\n${statusFailed(bottom)}\n`;
}

export async function getPromptModule(): Promise<PromptModule> {
  ensurePromptInteractionAvailable();
  const { confirm, input, password, select } = await import("@inquirer/prompts");
  return { confirm, input, password, select };
}

export async function confirmPrompt(
  options: Parameters<PromptConfirm>[0],
  context?: Parameters<PromptConfirm>[1],
): ReturnType<PromptConfirm> {
  const { confirm } = await getPromptModule();
  return confirm(options, context);
}

export async function inputPrompt(
  options: Parameters<PromptInput>[0],
  context?: Parameters<PromptInput>[1],
): ReturnType<PromptInput> {
  const { input } = await getPromptModule();
  return input(options, context);
}

export async function passwordPrompt(
  options: Parameters<PromptPassword>[0],
  context?: Parameters<PromptPassword>[1],
): ReturnType<PromptPassword> {
  const { password } = await getPromptModule();
  return password(options, context);
}

export async function selectPrompt<Value>(
  options: Parameters<PromptSelect>[0],
  context?: Parameters<PromptSelect>[1],
): Promise<Value> {
  const { select } = await getPromptModule();
  return select<Value>(options as never, context);
}

function joinPromptFacts(facts: string[]): string {
  const nonEmpty = facts.filter((value) => value.trim().length > 0);
  if (nonEmpty.length === 0) {
    return "";
  }

  const widthClass = getOutputWidthClass();
  const limit = widthClass === "narrow" ? 2 : widthClass === "compact" ? 3 : 4;
  return nonEmpty.slice(0, limit).join(faint(` ${inlineSeparator().trim()} `));
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
  return muted(status);
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
      ? muted(`$${Math.round(params.tokenPrice).toLocaleString("en-US")}/token`)
      : "",
  ];

  const metadata = joinPromptFacts(facts);
  return metadata.length > 0
    ? `${poolAsset(params.symbol)}  ${faint(supportsUnicodeOutput() ? "·" : "-")}  ${metadata}`
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
      ? muted(params.usdValue)
      : "",
    renderStatusFact(params.status),
    params.chain ? chainName(params.chain) : "",
  ];
  const metadata = joinPromptFacts(facts);
  return metadata.length > 0
    ? `${params.poolAccountId}  ${faint(supportsUnicodeOutput() ? "·" : "-")}  ${metadata}`
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

export function isHighStakesUsdAmount(params: {
  amount: bigint;
  decimals: number;
  chainIsTestnet: boolean;
  tokenPrice?: number | null;
}): boolean {
  if (params.chainIsTestnet) {
    return false;
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
  standardDefault?: boolean;
  highStakesToken: string;
  highStakesWarning: string;
  confirm: (options: { message: string; default?: boolean }) => Promise<boolean>;
}): Promise<boolean> {
  if (params.severity === "standard") {
    return params.confirm({
      message: params.standardMessage,
      default: params.standardDefault ?? true,
    });
  }

  process.stderr.write(
    formatSeverityWarningBlock(params.highStakesWarning, params.highStakesToken),
  );
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const typed = await inputPrompt({
      message: `Type "${params.highStakesToken}" to confirm:`,
    });
    const normalized = typed.trim();
    if (normalized === "") {
      return false;
    }
    const matches = normalized === params.highStakesToken;
    if (matches) {
      return true;
    }
    process.stderr.write(
      `${statusFailed(confirmationTokenMismatchMessage(params.highStakesToken))}\n`,
    );
  }
  return false;
}
