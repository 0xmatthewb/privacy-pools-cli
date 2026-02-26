import type { Address, Hex } from "viem";
import type {
  ChainConfig,
  RelayerDetailsResponse,
  RelayerQuoteResponse,
  RelayerRequestResponse,
} from "../types.js";
import { CLIError } from "../utils/errors.js";

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

async function relayerFetch(
  chainConfig: ChainConfig,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = `${chainConfig.relayerHost}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    signal: options?.signal ?? AbortSignal.timeout(30_000),
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
        "Re-request a quote and regenerate the proof."
      );
    }
    if (res.status === 503) {
      throw new CLIError(
        `Relayer: service at capacity.`,
        "RELAYER",
        "Wait and retry."
      );
    }
    throw new CLIError(
      `Relayer request failed (${res.status}): ${message}`,
      "RELAYER"
    );
  }

  return res;
}

export async function getRelayerDetails(
  chainConfig: ChainConfig,
  assetAddress: Address
): Promise<RelayerDetailsResponse> {
  const res = await relayerFetch(
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
  const res = await relayerFetch(chainConfig, "/relayer/quote", {
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
      "Relayer returned malformed quote payload (missing or non-numeric feeBPS).",
      "RELAYER"
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
      typeof fc.extraGas === "boolean" &&
      isHexString(fc.signedRelayerCommitment);

    if (!valid) {
      throw new CLIError(
        "Relayer returned malformed feeCommitment payload.",
        "RELAYER",
        "Request a fresh quote and retry."
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
  const res = await relayerFetch(chainConfig, "/relayer/request", {
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
  const body = await res.json();

  if (body?.success !== true) {
    throw new CLIError(
      "Relayer did not accept the withdrawal request.",
      "RELAYER"
    );
  }

  if (!isHexString(body?.txHash) || body.txHash.length !== 66) {
    throw new CLIError(
      "Relayer response missing a valid transaction hash.",
      "RELAYER"
    );
  }

  return body as RelayerRequestResponse;
}
