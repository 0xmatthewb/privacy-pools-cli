import type { Address, Hex } from "viem";
import type {
  ChainConfig,
  RelayerDetailsResponse,
  RelayerQuoteResponse,
  RelayerRequestResponse,
} from "../types.js";
import { CLIError } from "../utils/errors.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";

const RELAYER_MAX_RETRIES = 2;
const RELAYER_RETRY_DELAYS_MS = [250, 500] as const;

class RetryableRelayerHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string
  ) {
    super(`Retryable relayer HTTP ${status} ${statusText}`);
    this.name = "RetryableRelayerHttpError";
  }
}

const defaultRelayerRetryWait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

let relayerRetryWait = defaultRelayerRetryWait;

export function overrideRelayerRetryWaitForTests(
  waitFn?: (ms: number) => Promise<void>
): void {
  relayerRetryWait = waitFn ?? defaultRelayerRetryWait;
}

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function isRetryableRelayerTransportError(error: unknown): boolean {
  if (error instanceof RetryableRelayerHttpError) return true;
  if (error instanceof CLIError) return false;
  if (!(error instanceof Error)) return false;

  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }

  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET"
  ) {
    return true;
  }

  return error instanceof TypeError
    || error.message.includes("fetch")
    || error.message.includes("ECONNREFUSED")
    || error.message.includes("ETIMEDOUT")
    || error.message.includes("ENOTFOUND")
    || error.message.includes("ECONNRESET")
    || error.message.includes("aborted");
}

function relayerUnavailableError(message: string): CLIError {
  return new CLIError(
    `Relayer request failed: ${message}`,
    "RELAYER",
    "Check your network connection and try again. If it persists, the relayer may be temporarily down."
  );
}

function relayerTransportError(error: unknown): CLIError {
  const message = error instanceof Error ? error.message : "network error";
  return relayerUnavailableError(message);
}

async function runRelayerRequestWithRetry<T>(
  request: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt <= RELAYER_MAX_RETRIES; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!isRetryableRelayerTransportError(error)) {
        throw error;
      }

      if (attempt === RELAYER_MAX_RETRIES) {
        if (error instanceof RetryableRelayerHttpError) {
          throw relayerUnavailableError(
            error.statusText || `HTTP ${error.status}`
          );
        }
        throw relayerTransportError(error);
      }

      await relayerRetryWait(RELAYER_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw relayerUnavailableError("Unknown relayer error");
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

  if (typeof body?.feeBPS !== "string" || !/^\d+$/.test(body.feeBPS)) {
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
    if (isRetryableRelayerTransportError(error)) {
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
