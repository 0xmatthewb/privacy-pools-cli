import { decodeAbiParameters, parseAbiParameters, type Address, type Hex } from "viem";
import type {
  ChainConfig,
  RelayerDetailsResponse,
  RelayerQuoteResponse,
  RelayerRequestResponse,
} from "../types.js";
import { CLIError, sanitizeDiagnosticText } from "../utils/errors.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";
import {
  isTransientNetworkError,
  retryWithBackoff,
} from "../utils/network.js";
import type { RetryConfig } from "../utils/network.js";

const RELAYER_MAX_RETRIES = 2;
const RELAYER_RETRY_DELAYS_MS = [250, 500] as const;
const RELAYER_WITHDRAWAL_DATA_PARAMS = parseAbiParameters(
  "address recipient, address feeRecipient, uint256 relayFeeBPS",
);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

class RetryableRelayerHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string
  ) {
    super(`Retryable relayer HTTP ${status} ${statusText}`);
    this.name = "RetryableRelayerHttpError";
  }
}

let relayerWaitFn: RetryConfig["waitFn"];

/**
 * Override the retry wait function for relayer tests only.
 * Does not affect ASP retry timing.
 * Call with no argument to restore the default.
 */
export function overrideRelayerRetryWaitForTests(
  waitFn?: (ms: number) => Promise<void>
): void {
  relayerWaitFn = waitFn;
}

export interface ValidatedRelayerWithdrawalData {
  recipient: Address;
  feeRecipient: Address;
  relayFeeBPS: bigint;
  withdrawalData: Hex;
}

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isValidTransactionCostDetail(
  value: unknown
): value is { gas: string; eth: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    isDecimalString((value as Record<string, unknown>).gas) &&
    isDecimalString((value as Record<string, unknown>).eth)
  );
}

function isRetryableRelayerError(error: unknown): boolean {
  return error instanceof RetryableRelayerHttpError || isTransientNetworkError(error);
}

function relayerUnavailableError(message: string): CLIError {
  const detail = sanitizeDiagnosticText(message);
  return new CLIError(
    detail === "unknown error"
      ? "Relayer request failed."
      : `Relayer request failed: ${detail}`,
    "RELAYER",
    "Check your network connection and try again. If it persists, the relayer may be temporarily down."
  );
}

function relayerTransportError(error: unknown): CLIError {
  const message = error instanceof Error ? error.message : "network error";
  return relayerUnavailableError(message);
}

export function decodeValidatedRelayerWithdrawalData(params: {
  quote: Pick<RelayerQuoteResponse, "feeCommitment">;
  requestedRecipient: Address;
  quoteFeeBPS: bigint;
}): ValidatedRelayerWithdrawalData {
  const feeCommitment = params.quote.feeCommitment;
  if (!feeCommitment) {
    throw new CLIError(
      "Relayer quote is missing required fee details.",
      "RELAYER",
      "The relayer may not support this asset/chain combination.",
    );
  }

  let decodedRecipient: Address;
  let decodedFeeRecipient: Address;
  let decodedRelayFeeBPS: bigint;
  try {
    [
      decodedRecipient,
      decodedFeeRecipient,
      decodedRelayFeeBPS,
    ] = decodeAbiParameters(
      RELAYER_WITHDRAWAL_DATA_PARAMS,
      feeCommitment.withdrawalData,
    ) as [Address, Address, bigint];
  } catch {
    throw new CLIError(
      "Relayer returned malformed withdrawal data.",
      "RELAYER",
      "Run the withdraw command again to request a fresh quote.",
    );
  }

  if (
    decodedRecipient.toLowerCase() !== params.requestedRecipient.toLowerCase()
  ) {
    throw new CLIError(
      "Relayer quote recipient does not match the requested withdrawal recipient.",
      "RELAYER",
      "Run the withdraw command again to request a fresh quote.",
    );
  }

  if (decodedRelayFeeBPS !== params.quoteFeeBPS) {
    throw new CLIError(
      "Relayer quote fee data does not match the quoted relay fee.",
      "RELAYER",
      "Run the withdraw command again to request a fresh quote.",
    );
  }

  if (decodedRecipient.toLowerCase() === ZERO_ADDRESS) {
    throw new CLIError(
      "Relayer quote recipient cannot be the zero address.",
      "RELAYER",
      "Run the withdraw command again to request a fresh quote.",
    );
  }

  if (decodedFeeRecipient.toLowerCase() === ZERO_ADDRESS) {
    throw new CLIError(
      "Relayer quote fee recipient cannot be the zero address.",
      "RELAYER",
      "Run the withdraw command again to request a fresh quote.",
    );
  }

  return {
    recipient: decodedRecipient,
    feeRecipient: decodedFeeRecipient,
    relayFeeBPS: decodedRelayFeeBPS,
    withdrawalData: feeCommitment.withdrawalData,
  };
}

export function isUnsupportedExtraGasRelayerError(error: unknown): boolean {
  if (!(error instanceof CLIError)) {
    return false;
  }

  return `${error.message} ${error.hint ?? ""}`.includes("UNSUPPORTED_FEATURE");
}

export async function requestQuoteWithExtraGasFallback(
  chainConfig: ChainConfig,
  params: {
    amount: bigint;
    asset: Address;
    extraGas: boolean;
    recipient?: Address;
  }
): Promise<{
  quote: RelayerQuoteResponse;
  extraGas: boolean;
  downgradedExtraGas: boolean;
}> {
  try {
    return {
      quote: await requestQuote(chainConfig, params),
      extraGas: params.extraGas,
      downgradedExtraGas: false,
    };
  } catch (error) {
    if (!params.extraGas || !isUnsupportedExtraGasRelayerError(error)) {
      throw error;
    }

    return {
      quote: await requestQuote(chainConfig, {
        ...params,
        extraGas: false,
      }),
      extraGas: false,
      downgradedExtraGas: true,
    };
  }
}

async function runRelayerRequestWithRetry<T>(
  request: () => Promise<T>
): Promise<T> {
  return retryWithBackoff(request, {
    maxRetries: RELAYER_MAX_RETRIES,
    delayMs: (attempt) => RELAYER_RETRY_DELAYS_MS[attempt - 1] ?? 500,
    isRetryable: isRetryableRelayerError,
    onExhausted: (error): never => {
      if (error instanceof RetryableRelayerHttpError) {
        throw relayerUnavailableError(
          error.statusText || `HTTP ${error.status}`
        );
      }
      throw relayerTransportError(error);
    },
    waitFn: relayerWaitFn,
  });
}

async function relayerFetch(
  chainConfig: ChainConfig,
  path: string,
  options?: RequestInit,
  allowRetryableGatewayStatuses: boolean = false
): Promise<Response> {
  const url = `${chainConfig.relayerHost}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    signal: options?.signal ?? AbortSignal.timeout(getNetworkTimeoutMs()),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as any)?.message ??
      (body as any)?.error?.message ??
      res.statusText;

    if (res.status === 422) {
      throw new CLIError(
        `Relayer: fee commitment expired.`,
        "RELAYER",
        "Run the withdraw command again to get a fresh quote."
      );
    }
    if (res.status === 503) {
      throw new CLIError(
        `Relayer: service at capacity.`,
        "RELAYER",
        "The relayer is busy. Wait a moment and try again."
      );
    }
    if (allowRetryableGatewayStatuses && (res.status === 502 || res.status === 504)) {
      throw new RetryableRelayerHttpError(res.status, res.statusText || message);
    }
    throw relayerUnavailableError(message);
  }

  return res;
}

async function relayerFetchWithRetry(
  chainConfig: ChainConfig,
  path: string,
  options?: RequestInit
): Promise<Response> {
  return runRelayerRequestWithRetry(() =>
    relayerFetch(chainConfig, path, options, true)
  );
}

export async function getRelayerDetails(
  chainConfig: ChainConfig,
  assetAddress: Address
): Promise<RelayerDetailsResponse> {
  const res = await relayerFetchWithRetry(
    chainConfig,
    `/relayer/details?chainId=${chainConfig.id}&assetAddress=${assetAddress}`
  );
  return res.json();
}

export async function requestQuote(
  chainConfig: ChainConfig,
  params: {
    amount: bigint;
    asset: Address;
    extraGas: boolean;
    recipient?: Address;
  }
): Promise<RelayerQuoteResponse> {
  const res = await relayerFetchWithRetry(chainConfig, "/relayer/quote", {
    method: "POST",
    body: JSON.stringify({
      chainId: chainConfig.id,
      amount: params.amount.toString(),
      asset: params.asset,
      extraGas: params.extraGas,
      ...(params.recipient ? { recipient: params.recipient } : {}),
    }),
  });
  const body = await res.json();

  const relayTxCost = body?.detail?.relayTxCost;
  const extraGasFundAmount = body?.detail?.extraGasFundAmount;
  const extraGasTxCost = body?.detail?.extraGasTxCost;

  if (
    !isDecimalString(body?.baseFeeBPS) ||
    !isDecimalString(body?.feeBPS) ||
    !isDecimalString(body?.gasPrice) ||
    !isValidTransactionCostDetail(relayTxCost) ||
    (extraGasFundAmount !== undefined &&
      !isValidTransactionCostDetail(extraGasFundAmount)) ||
    (extraGasTxCost !== undefined &&
      !isValidTransactionCostDetail(extraGasTxCost))
  ) {
    throw new CLIError(
      "Relayer returned an unexpected quote response.",
      "RELAYER",
      "Try again. If it persists, the relayer may be running an incompatible version."
    );
  }

  if (body?.feeCommitment !== undefined) {
    const fc = body.feeCommitment;
    const valid =
      typeof fc?.expiration === "number" &&
      Number.isFinite(fc.expiration) &&
      isHexString(fc.withdrawalData) &&
      typeof fc.asset === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(fc.asset) &&
      typeof fc.amount === "string" &&
      /^\d+$/.test(fc.amount) &&
      typeof fc.extraGas === "boolean" &&
      isHexString(fc.signedRelayerCommitment);

    if (!valid) {
      throw new CLIError(
        "Relayer returned an invalid fee commitment.",
        "RELAYER",
        "Run the withdraw command again to request a fresh quote."
      );
    }

    // Quote bindings should match what we requested.
    if (fc.asset.toLowerCase() !== params.asset.toLowerCase()) {
      throw new CLIError(
        "Relayer returned a fee commitment for a different asset.",
        "RELAYER",
        "Run the withdraw command again to request a fresh quote."
      );
    }

    if (BigInt(fc.amount) !== params.amount) {
      throw new CLIError(
        "Relayer returned a fee commitment for a different withdrawal amount.",
        "RELAYER",
        "Run the withdraw command again to request a fresh quote."
      );
    }

    if (fc.extraGas !== params.extraGas) {
      throw new CLIError(
        "Relayer returned a fee commitment with mismatched extra-gas setting.",
        "RELAYER",
        "Run the withdraw command again to request a fresh quote."
      );
    }
  }

  return body as RelayerQuoteResponse;
}

export async function submitRelayRequest(
  chainConfig: ChainConfig,
  params: {
    scope: bigint;
    withdrawal: { processooor: Address; data: Hex };
    proof: any;
    publicSignals: string[];
    feeCommitment: RelayerQuoteResponse["feeCommitment"];
  }
): Promise<RelayerRequestResponse> {
  let res: Response;
  try {
    res = await relayerFetch(chainConfig, "/relayer/request", {
      method: "POST",
      body: JSON.stringify({
        chainId: chainConfig.id,
        scope: params.scope.toString(), // decimal string
        withdrawal: {
          processooor: params.withdrawal.processooor,
          data: params.withdrawal.data,
        },
        proof: params.proof,
        publicSignals: params.publicSignals,
        feeCommitment: params.feeCommitment,
      }),
    });
  } catch (error) {
    if (isTransientNetworkError(error)) {
      throw relayerTransportError(error);
    }
    throw error;
  }

  const body = await res.json();

  if (body?.success !== true) {
    throw new CLIError(
      "Relayer did not accept the withdrawal request.",
      "RELAYER",
      "Try again. If it persists, run 'privacy-pools sync' and retry."
    );
  }

  if (!isHexString(body?.txHash) || body.txHash.length !== 66) {
    throw new CLIError(
      "Relayer response missing a valid transaction hash.",
      "RELAYER",
      "The relayer may have processed the request but returned an incomplete response. Check 'privacy-pools history' for the transaction."
    );
  }

  return body as RelayerRequestResponse;
}
