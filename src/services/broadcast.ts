import {
  encodeFunctionData,
  isAddress,
  isHex,
  parseTransaction,
  type Address,
  type Hex,
  recoverTransactionAddress,
} from "viem";
import { explorerTxUrl } from "../config/chains.js";
import type { ChainConfig } from "../types.js";
import { CLIError, sanitizeDiagnosticText } from "../utils/errors.js";
import { getConfirmationTimeoutMs } from "../utils/mode.js";
import {
  entrypointRelayAbi,
  type UnsignedDepositOutput,
  type UnsignedDirectWithdrawOutput,
  type UnsignedRelayedWithdrawOutput,
  type UnsignedRagequitOutput,
} from "../utils/unsigned-flows.js";
import {
  toWithdrawSolidityProof,
  type UnsignedTransactionPayload,
} from "../utils/unsigned.js";
import { resolveChain } from "../utils/validation.js";
import { submitRelayRequest, decodeValidatedRelayerWithdrawalData, getRelayerHosts } from "./relayer.js";
import { getPublicClient } from "./sdk.js";

export type BroadcastSourceOperation = "deposit" | "withdraw" | "ragequit";
export type BroadcastMode = "onchain" | "relayed";
export type BroadcastTransactionStatus = "confirmed" | "validated";

export interface BroadcastTransactionResult {
  index: number;
  description: string;
  txHash: Hex | null;
  blockNumber: string | null;
  explorerUrl: string | null;
  status: BroadcastTransactionStatus;
}

export interface BroadcastResult {
  mode: "broadcast";
  broadcastMode: BroadcastMode;
  sourceOperation: BroadcastSourceOperation;
  chain: string;
  validatedOnly?: boolean;
  submittedBy?: Address;
  transactions: BroadcastTransactionResult[];
  localStateUpdated: false;
}

type BroadcastEnvelope =
  | (UnsignedDepositOutput & SuccessEnvelopeFields & {
      signedTransactions?: Hex[];
    })
  | (UnsignedDirectWithdrawOutput & SuccessEnvelopeFields & {
      signedTransactions?: Hex[];
    })
  | (UnsignedRelayedWithdrawOutput & SuccessEnvelopeFields & {
      relayerHost?: string | null;
      signedTransactions?: Hex[];
    })
  | (UnsignedRagequitOutput & SuccessEnvelopeFields & {
      signedTransactions?: Hex[];
    });

type SuccessEnvelopeFields = {
  schemaVersion?: unknown;
  success?: unknown;
};

type BroadcastableSignedEnvelope = Extract<
  BroadcastEnvelope,
  { operation: "deposit" | "ragequit" } | { operation: "withdraw"; withdrawMode: "direct" }
>;

interface SubmittedTransactionDetail {
  index: number;
  description: string;
  txHash: Hex;
  explorerUrl: string | null;
  status: "submitted" | "confirmed";
  blockNumber?: string;
}

interface ParsedRelayerRequest {
  scope: bigint;
  withdrawal: {
    processooor: Address;
    data: Hex;
  };
  proof: unknown;
  publicSignals: unknown[];
  feeCommitment: {
    expiration: number;
    withdrawalData: Hex;
    asset: Address;
    amount: string;
    extraGas: boolean;
    signedRelayerCommitment: Hex;
  };
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HEX_PATTERN = /^0x[0-9a-fA-F]*$/;
const DECIMAL_PATTERN = /^\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  options: { optional?: boolean; allowEmpty?: boolean } = {},
): string {
  const value = record[key];
  if (value === undefined || value === null) {
    if (options.optional) return "";
    throw new CLIError(
      `Broadcast envelope is missing '${key}'.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (typeof value !== "string") {
    throw new CLIError(
      `Broadcast envelope field '${key}' must be a string.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (!options.allowEmpty && value.trim().length === 0) {
    throw new CLIError(
      `Broadcast envelope field '${key}' cannot be empty.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new CLIError(
      `Broadcast envelope field '${key}' must be a string when present.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (value.trim().length === 0) {
    throw new CLIError(
      `Broadcast envelope field '${key}' cannot be empty when present.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  return value;
}

function readAddress(
  record: Record<string, unknown>,
  key: string,
): Address {
  const value = readString(record, key);
  if (!isAddress(value)) {
    throw new CLIError(
      `Broadcast envelope field '${key}' must be a valid address.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  return value;
}

function readNullableAddress(
  record: Record<string, unknown>,
  key: string,
): Address | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    throw new CLIError(
      `Broadcast envelope is missing '${key}'.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || !isAddress(value)) {
    throw new CLIError(
      `Broadcast envelope field '${key}' must be a valid address or null.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  return value;
}

function readHex(
  record: Record<string, unknown>,
  key: string,
): Hex {
  const value = readString(record, key, { allowEmpty: true });
  if (!isHex(value)) {
    throw new CLIError(
      `Broadcast envelope field '${key}' must be hex data.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  return value;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new CLIError(
      `Broadcast envelope field '${key}' must be a boolean.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  return value;
}

function readDecimalString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = readString(record, key, { allowEmpty: false });
  if (!DECIMAL_PATTERN.test(value)) {
    throw new CLIError(
      `Broadcast envelope field '${key}' must be a decimal string.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  return value;
}

function readInteger(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CLIError(
      `Broadcast envelope field '${key}' must be an integer.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  return value;
}

function validateUnsignedTransactionPayload(
  value: unknown,
  index: number,
): UnsignedTransactionPayload {
  if (!isRecord(value)) {
    throw new CLIError(
      `Broadcast envelope transaction ${index + 1} is malformed.`,
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }

  return {
    chainId: readInteger(value, "chainId"),
    from: readNullableAddress(value, "from"),
    to: readAddress(value, "to"),
    value: readDecimalString(value, "value"),
    data: readHex(value, "data"),
    description: readString(value, "description"),
  };
}

function parseEnvelope(input: unknown): BroadcastEnvelope {
  if (Array.isArray(input)) {
    throw new CLIError(
      "Broadcast requires the full unsigned envelope JSON, not a raw transaction array.",
      "INPUT",
      "Use the default --unsigned envelope format, add signedTransactions when needed, then pass that full JSON envelope to broadcast.",
      "INPUT_BROADCAST_REQUIRES_ENVELOPE",
    );
  }
  if (!isRecord(input)) {
    throw new CLIError(
      "Broadcast expects a JSON object envelope.",
      "INPUT",
      "Pass the full unsigned envelope JSON from --unsigned, not a raw transaction array or inline string.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (input.success !== undefined && input.success !== true) {
    throw new CLIError(
      "Broadcast expects a successful unsigned envelope.",
      "INPUT",
      "Build a fresh unsigned envelope with --unsigned before signing or relaying.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (input.mode !== "unsigned") {
    throw new CLIError(
      "Broadcast only accepts unsigned envelopes.",
      "INPUT",
      "Use the default --unsigned envelope format, then add signedTransactions when needed.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }

  const operation = readString(input, "operation");
  if (
    operation !== "deposit"
    && operation !== "withdraw"
    && operation !== "ragequit"
  ) {
    throw new CLIError(
      `Unsupported broadcast operation '${operation}'.`,
      "INPUT",
      "Broadcast only supports deposit, withdraw, and ragequit unsigned envelopes.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }

  const chain = readString(input, "chain");
  const rawTransactions = input.transactions;
  if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
    throw new CLIError(
      "Broadcast envelope must include a non-empty transactions array.",
      "INPUT",
      "Use the default --unsigned envelope JSON and keep the original fields intact.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  const transactions = rawTransactions.map((entry, index) =>
    validateUnsignedTransactionPayload(entry, index)
  );

  if (operation === "withdraw") {
    const withdrawMode = readString(input, "withdrawMode");
    if (withdrawMode !== "direct" && withdrawMode !== "relayed") {
      throw new CLIError(
        `Unsupported withdraw broadcast mode '${withdrawMode}'.`,
        "INPUT",
        "Broadcast only supports withdraw envelopes with withdrawMode 'direct' or 'relayed'.",
        "INPUT_BROADCAST_INVALID_ENVELOPE",
      );
    }

    if (withdrawMode === "direct") {
      return {
        ...input,
        mode: "unsigned",
        operation: "withdraw",
        withdrawMode: "direct",
        chain,
        asset: readString(input, "asset"),
        amount: readDecimalString(input, "amount"),
        recipient: readAddress(input, "recipient"),
        selectedCommitmentLabel: readDecimalString(input, "selectedCommitmentLabel"),
        selectedCommitmentValue: readDecimalString(input, "selectedCommitmentValue"),
        privacyCostManifest: isRecord(input.privacyCostManifest)
          ? input.privacyCostManifest
          : {},
        warnings: Array.isArray(input.warnings) ? input.warnings : [],
        transactions,
        signedTransactions: Array.isArray(input.signedTransactions)
          ? input.signedTransactions as Hex[]
          : undefined,
      };
    }

    return {
      ...input,
      mode: "unsigned",
      operation: "withdraw",
      withdrawMode: "relayed",
      chain,
      asset: readString(input, "asset"),
      amount: readDecimalString(input, "amount"),
      recipient: readAddress(input, "recipient"),
      selectedCommitmentLabel: readDecimalString(input, "selectedCommitmentLabel"),
      selectedCommitmentValue: readDecimalString(input, "selectedCommitmentValue"),
      feeBPS: readDecimalString(input, "feeBPS"),
      quoteExpiresAt: readString(input, "quoteExpiresAt"),
      warnings: Array.isArray(input.warnings) ? input.warnings : [],
      transactions,
      relayerRequest: input.relayerRequest,
      relayerHost: readOptionalString(input, "relayerHost"),
      signedTransactions: Array.isArray(input.signedTransactions)
        ? input.signedTransactions as Hex[]
        : undefined,
    };
  }

  if (operation === "deposit") {
    return {
      ...input,
      mode: "unsigned",
      operation: "deposit",
      chain,
      asset: readString(input, "asset"),
      amount: readDecimalString(input, "amount"),
      precommitment: readDecimalString(input, "precommitment"),
      warnings: Array.isArray(input.warnings) ? input.warnings : [],
      transactions,
      signedTransactions: Array.isArray(input.signedTransactions)
        ? input.signedTransactions as Hex[]
        : undefined,
    };
  }

  return {
    ...input,
    mode: "unsigned",
    operation: "ragequit",
    chain,
    asset: readString(input, "asset"),
    amount: readDecimalString(input, "amount"),
    selectedCommitmentLabel: readDecimalString(input, "selectedCommitmentLabel"),
    selectedCommitmentValue: readDecimalString(input, "selectedCommitmentValue"),
    privacyCostManifest: isRecord(input.privacyCostManifest)
      ? input.privacyCostManifest
      : {},
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    transactions,
    signedTransactions: Array.isArray(input.signedTransactions)
      ? input.signedTransactions as Hex[]
      : undefined,
  };
}

function parseSignedTransactions(envelope: BroadcastableSignedEnvelope): Hex[] {
  if (!Array.isArray(envelope.signedTransactions)) {
    throw new CLIError(
      "Signed onchain broadcast requires 'signedTransactions' in the envelope.",
      "INPUT",
      "Add signedTransactions[] to the original unsigned envelope before calling broadcast.",
      "INPUT_BROADCAST_MISSING_SIGNED_TRANSACTIONS",
    );
  }
  if (envelope.signedTransactions.length !== envelope.transactions.length) {
    throw new CLIError(
      "signedTransactions length must exactly match transactions length.",
      "INPUT",
      "Keep the original transaction order and provide one signed transaction per preview transaction.",
      "INPUT_BROADCAST_SIGNED_TRANSACTION_COUNT_MISMATCH",
      false,
      "inline",
      {
        transactionCount: envelope.transactions.length,
        signedTransactionCount: envelope.signedTransactions.length,
      },
    );
  }

  return envelope.signedTransactions.map((transaction, index) => {
    if (typeof transaction !== "string" || !HEX_PATTERN.test(transaction)) {
      throw new CLIError(
        `signedTransactions[${index}] must be a hex string.`,
        "INPUT",
        "Keep the original transaction order and provide one signed hex transaction per preview transaction.",
        "INPUT_BROADCAST_INVALID_SIGNED_TRANSACTION",
      );
    }
    return transaction as Hex;
  });
}

function normalizePreviewTransactionChain(
  chainConfig: ChainConfig,
  transactions: readonly UnsignedTransactionPayload[],
): void {
  for (const [index, transaction] of transactions.entries()) {
    if (transaction.chainId !== chainConfig.id) {
      throw new CLIError(
        `Preview transaction ${index + 1} targets chainId ${transaction.chainId}, but the envelope chain resolves to ${chainConfig.id}.`,
        "INPUT",
        "Use the original unsigned envelope without editing the chain or transaction metadata.",
        "INPUT_BROADCAST_CHAIN_MISMATCH",
      );
    }
  }
}

function buildPartialSubmissionError(
  message: string,
  category: "RPC" | "CONTRACT",
  hint: string,
  submittedTransactions: SubmittedTransactionDetail[],
  failedAtIndex: number,
  code: string,
): CLIError {
  return new CLIError(
    message,
    category,
    hint,
    code,
    false,
    undefined,
    {
      submittedTransactions,
      failedAtIndex,
    },
  );
}

function normalizedTransactionData(
  parsed: ReturnType<typeof parseTransaction>,
): Hex {
  const record = parsed as { data?: Hex; input?: Hex };
  return (record.data ?? record.input ?? "0x") as Hex;
}

async function validateSignedBundle(
  chainConfig: ChainConfig,
  envelope: BroadcastableSignedEnvelope,
  signedTransactions: readonly Hex[],
): Promise<{ signer: Address; validatedSignerByIndex: Address[] }> {
  normalizePreviewTransactionChain(chainConfig, envelope.transactions);

  const recoveredSigners: Address[] = [];

  for (const [index, signedTransaction] of signedTransactions.entries()) {
    let parsed;
    try {
      parsed = parseTransaction(signedTransaction);
    } catch {
      throw new CLIError(
        `signedTransactions[${index}] could not be parsed as a signed transaction.`,
        "INPUT",
        "Provide serialized signed transactions returned by your signer or wallet.",
        "INPUT_BROADCAST_INVALID_SIGNED_TRANSACTION",
      );
    }

    const preview = envelope.transactions[index];
    const parsedTo = (parsed as { to?: Address | null }).to;
    const parsedChainId = (parsed as { chainId?: number | bigint }).chainId;
    const parsedValue = (parsed as { value?: bigint }).value ?? 0n;
    const parsedData = normalizedTransactionData(parsed);

    if (!parsedTo || parsedTo.toLowerCase() !== preview.to.toLowerCase()) {
      throw new CLIError(
        `signedTransactions[${index}] does not match the preview target address.`,
        "INPUT",
        "Sign the exact preview transactions in order without editing the destination.",
        "INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH",
      );
    }
    if (String(parsedChainId) !== String(preview.chainId)) {
      throw new CLIError(
        `signedTransactions[${index}] does not match the preview chainId.`,
        "INPUT",
        "Sign the exact preview transactions in order without editing the chain.",
        "INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH",
      );
    }
    if (parsedValue.toString() !== preview.value) {
      throw new CLIError(
        `signedTransactions[${index}] does not match the preview value.`,
        "INPUT",
        "Sign the exact preview transactions in order without editing the value.",
        "INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH",
      );
    }
    if (parsedData.toLowerCase() !== preview.data.toLowerCase()) {
      throw new CLIError(
        `signedTransactions[${index}] does not match the preview calldata.`,
        "INPUT",
        "Sign the exact preview transactions in order without editing the calldata.",
        "INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH",
      );
    }

    const signer = await recoverTransactionAddress({
      serializedTransaction:
        signedTransaction as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"],
    });
    recoveredSigners.push(signer);

    if (
      preview.from !== null
      && signer.toLowerCase() !== preview.from.toLowerCase()
    ) {
      throw new CLIError(
        `signedTransactions[${index}] was signed by ${signer}, but the preview requires ${preview.from}.`,
        "INPUT",
        "Sign the envelope with the required caller address shown in the preview.",
        "INPUT_BROADCAST_SIGNER_MISMATCH",
        false,
        "inline",
        {
          requiredFrom: preview.from,
          recoveredSigner: signer,
          failedAtIndex: index,
        },
      );
    }
  }

  const firstSigner = recoveredSigners[0];
  if (!firstSigner) {
    throw new CLIError(
      "Broadcast envelope must include at least one transaction.",
      "INPUT",
      "Use the original unsigned envelope without removing transactions.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (
    recoveredSigners.some(
      (signer) => signer.toLowerCase() !== firstSigner.toLowerCase(),
    )
  ) {
    throw new CLIError(
      "All signedTransactions in a bundle must be signed by the same address.",
      "INPUT",
      "Re-sign the full bundle with the same signer in the original order.",
      "INPUT_BROADCAST_MIXED_SIGNERS",
      false,
      "inline",
      {
        recoveredSigners,
      },
    );
  }

  return {
    signer: firstSigner,
    validatedSignerByIndex: recoveredSigners,
  };
}

async function broadcastSignedEnvelope(
  chainConfig: ChainConfig,
  envelope: BroadcastableSignedEnvelope,
  rpcOverride?: string,
  validateOnly: boolean = false,
): Promise<BroadcastResult> {
  const signedTransactions = parseSignedTransactions(envelope);
  const { signer } = await validateSignedBundle(
    chainConfig,
    envelope,
    signedTransactions,
  );
  if (validateOnly) {
    return {
      mode: "broadcast",
      broadcastMode: "onchain",
      sourceOperation: envelope.operation,
      chain: chainConfig.name,
      validatedOnly: true,
      submittedBy: signer,
      transactions: envelope.transactions.map((preview, index) => ({
        index,
        description: preview.description,
        txHash: null,
        blockNumber: null,
        explorerUrl: null,
        status: "validated",
      })),
      localStateUpdated: false,
    };
  }
  const publicClient = getPublicClient(chainConfig, rpcOverride);
  const submittedTransactions: SubmittedTransactionDetail[] = [];
  const confirmedTransactions: BroadcastTransactionResult[] = [];

  for (const [index, signedTransaction] of signedTransactions.entries()) {
    const preview = envelope.transactions[index];
    let txHash: Hex;
    try {
      txHash = await publicClient.request({
        method: "eth_sendRawTransaction",
        params: [signedTransaction],
      }) as Hex;
    } catch (error) {
      const detail = sanitizeDiagnosticText(
        error instanceof Error ? error.message : String(error),
      );
      throw buildPartialSubmissionError(
        `Failed to submit signed transaction ${index + 1}.`,
        "RPC",
        submittedTransactions.length > 0
          ? `Some earlier transactions were already accepted. Check those tx hashes before retrying. RPC detail: ${detail}`
          : `Check the RPC connection and signer output, then retry only if the transaction was not already accepted. RPC detail: ${detail}`,
        submittedTransactions,
        index,
        "RPC_BROADCAST_SUBMISSION_FAILED",
      );
    }

    submittedTransactions.push({
      index,
      description: preview.description,
      txHash,
      explorerUrl: explorerTxUrl(chainConfig.id, txHash),
      status: "submitted",
    });

    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: getConfirmationTimeoutMs(),
      });
    } catch {
      throw buildPartialSubmissionError(
        `Timed out waiting for confirmation of signed transaction ${index + 1}.`,
        "RPC",
        "At least one transaction was already submitted. Check the submitted tx hashes before retrying to avoid duplicate execution.",
        submittedTransactions,
        index,
        "RPC_BROADCAST_CONFIRMATION_TIMEOUT",
      );
    }

    submittedTransactions[index] = {
      ...submittedTransactions[index],
      status: "confirmed",
      blockNumber: receipt.blockNumber.toString(),
    };

    if (receipt.status !== "success") {
      throw buildPartialSubmissionError(
        `Broadcast transaction ${index + 1} reverted onchain.`,
        "CONTRACT",
        "Check the submitted transaction on a block explorer before retrying. Do not assume later bundle steps were safe to repeat.",
        submittedTransactions,
        index,
        "CONTRACT_BROADCAST_REVERTED",
      );
    }

    confirmedTransactions.push({
      index,
      description: preview.description,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      explorerUrl: explorerTxUrl(chainConfig.id, txHash),
      status: "confirmed",
    });
  }

  return {
    mode: "broadcast",
    broadcastMode: "onchain",
    sourceOperation: envelope.operation,
    chain: chainConfig.name,
    submittedBy: signer,
    transactions: confirmedTransactions,
    localStateUpdated: false,
  };
}

function parseRelayerRequest(input: unknown): ParsedRelayerRequest {
  if (!isRecord(input)) {
    throw new CLIError(
      "Relayed broadcast requires a relayerRequest object in the envelope.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing the relayerRequest fields.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }

  const scopeString = readDecimalString(input, "scope");
  const withdrawalRecord = input.withdrawal;
  const feeCommitmentRecord = input.feeCommitment;
  const publicSignals = input.publicSignals;

  if (!isRecord(withdrawalRecord)) {
    throw new CLIError(
      "relayerRequest.withdrawal is malformed.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing the relayerRequest fields.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (!isRecord(feeCommitmentRecord)) {
    throw new CLIError(
      "relayerRequest.feeCommitment is malformed.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing the relayerRequest fields.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (!Array.isArray(publicSignals)) {
    throw new CLIError(
      "relayerRequest.publicSignals must be an array.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing the relayerRequest fields.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }

  return {
    scope: BigInt(scopeString),
    withdrawal: {
      processooor: readAddress(withdrawalRecord, "processooor"),
      data: readHex(withdrawalRecord, "data"),
    },
    proof: input.proof,
    publicSignals,
    feeCommitment: {
      expiration: readInteger(feeCommitmentRecord, "expiration"),
      withdrawalData: readHex(feeCommitmentRecord, "withdrawalData"),
      asset: readAddress(feeCommitmentRecord, "asset"),
      amount: readDecimalString(feeCommitmentRecord, "amount"),
      extraGas: readBoolean(feeCommitmentRecord, "extraGas"),
      signedRelayerCommitment: readHex(
        feeCommitmentRecord,
        "signedRelayerCommitment",
      ),
    },
  };
}

function resolveConfiguredRelayerUrl(
  chainConfig: ChainConfig,
  relayerHost: string | null | undefined,
): string | undefined {
  const candidates = getRelayerHosts(chainConfig);
  if (!relayerHost) {
    if (candidates.length <= 1) {
      return candidates[0];
    }

    throw new CLIError(
      "Relayed broadcast envelope is missing relayerHost.",
      "INPUT",
      "Use the original relayed --unsigned envelope without removing relayerHost, or regenerate it with the current CLI before broadcasting.",
      "INPUT_BROADCAST_MISSING_RELAYER_HOST",
    );
  }

  const normalizedRequestedHost = relayerHost.trim().toLowerCase();
  const matched = candidates.find((candidate) => {
    try {
      return new URL(candidate).host.toLowerCase() === normalizedRequestedHost;
    } catch {
      return candidate.trim().toLowerCase() === normalizedRequestedHost;
    }
  });

  if (!matched) {
    throw new CLIError(
      `Relayed broadcast targets relayer host '${relayerHost}', but that host is not configured for ${chainConfig.name}.`,
      "RELAYER",
      "Restore the same relayer host configuration that was used when the unsigned envelope was created, then retry broadcast.",
      "RELAYER_BROADCAST_RELAYER_HOST_MISMATCH",
    );
  }

  return matched;
}

async function broadcastRelayedEnvelope(
  chainConfig: ChainConfig,
  envelope: Extract<BroadcastEnvelope, { operation: "withdraw"; withdrawMode: "relayed" }>,
  rpcOverride?: string,
  validateOnly: boolean = false,
): Promise<BroadcastResult> {
  normalizePreviewTransactionChain(chainConfig, envelope.transactions);
  if (envelope.transactions.length !== 1) {
    throw new CLIError(
      "Relayed broadcast expects exactly one preview transaction.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing the transactions array.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }

  const expiresAtMs = Date.parse(envelope.quoteExpiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    throw new CLIError(
      "quoteExpiresAt must be a valid ISO timestamp.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing quoteExpiresAt.",
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }
  if (expiresAtMs <= Date.now()) {
    throw new CLIError(
      "Relayer quote has already expired.",
      "RELAYER",
      "Request a fresh relayed withdraw quote and regenerate the unsigned envelope before broadcasting.",
      "RELAYER_BROADCAST_QUOTE_EXPIRED",
    );
  }

  const relayerRequest = parseRelayerRequest(envelope.relayerRequest);
  let proof;
  try {
    proof = toWithdrawSolidityProof({
      proof: relayerRequest.proof as {
        pi_a: Array<string | number | bigint>;
        pi_b: Array<Array<string | number | bigint>>;
        pi_c: Array<string | number | bigint>;
      },
      publicSignals: relayerRequest.publicSignals as Array<string | number | bigint>,
    });
  } catch (error) {
    throw new CLIError(
      "Relayed broadcast proof data is malformed.",
      "INPUT",
      `Use the original relayed --unsigned envelope without editing relayerRequest.proof or publicSignals. Detail: ${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}`,
      "INPUT_BROADCAST_INVALID_ENVELOPE",
    );
  }

  const validatedWithdrawalData = decodeValidatedRelayerWithdrawalData({
    quote: {
      feeCommitment: relayerRequest.feeCommitment,
    },
    requestedRecipient: envelope.recipient,
    quoteFeeBPS: BigInt(envelope.feeBPS),
  });
  if (
    validatedWithdrawalData.withdrawalData.toLowerCase() !==
    relayerRequest.withdrawal.data.toLowerCase()
  ) {
    throw new CLIError(
      "relayerRequest withdrawal data does not match the relayer fee commitment.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing relayerRequest.",
      "INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH",
    );
  }

  const preview = envelope.transactions[0];
  const expectedRelayData = encodeFunctionData({
    abi: entrypointRelayAbi,
    functionName: "relay",
    args: [relayerRequest.withdrawal, proof, relayerRequest.scope],
  });
  if (preview.to.toLowerCase() !== chainConfig.entrypoint.toLowerCase()) {
    throw new CLIError(
      "Relayed preview transaction target does not match the chain entrypoint.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing the transaction target.",
      "INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH",
    );
  }
  if (preview.value !== "0") {
    throw new CLIError(
      "Relayed preview transaction value must be 0.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing the transaction value.",
      "INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH",
    );
  }
  if (preview.data.toLowerCase() !== expectedRelayData.toLowerCase()) {
    throw new CLIError(
      "Relayer request does not match the preview calldata.",
      "INPUT",
      "Use the original relayed --unsigned envelope without editing the relayerRequest or transactions fields.",
      "INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH",
    );
  }

  const relayerUrl = resolveConfiguredRelayerUrl(
    chainConfig,
    envelope.relayerHost,
  );
  if (validateOnly) {
    return {
      mode: "broadcast",
      broadcastMode: "relayed",
      sourceOperation: "withdraw",
      chain: chainConfig.name,
      validatedOnly: true,
      transactions: [
        {
          index: 0,
          description: preview.description,
          txHash: null,
          blockNumber: null,
          explorerUrl: null,
          status: "validated",
        },
      ],
      localStateUpdated: false,
    };
  }
  let relayResponse;
  try {
    relayResponse = await submitRelayRequest(chainConfig, {
      scope: relayerRequest.scope,
      withdrawal: relayerRequest.withdrawal,
      proof,
      publicSignals: relayerRequest.publicSignals.map((signal) => String(signal)),
      feeCommitment: relayerRequest.feeCommitment,
      ...(relayerUrl ? { relayerUrl } : {}),
    });
  } catch (error) {
    if (error instanceof CLIError) throw error;
    throw new CLIError(
      "Relayer submission failed.",
      "RELAYER",
      `Check relayer connectivity and the original quote details, then retry with a fresh quote if needed. Relayer detail: ${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}`,
      "RELAYER_BROADCAST_SUBMISSION_FAILED",
    );
  }

  const publicClient = getPublicClient(chainConfig, rpcOverride);
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: relayResponse.txHash,
      timeout: getConfirmationTimeoutMs(),
    });
  } catch {
    throw new CLIError(
      "Timed out waiting for relayed withdrawal confirmation.",
      "RPC",
      "The relayer request was already accepted. Check the submitted tx hash before retrying to avoid duplicate execution.",
      "RPC_BROADCAST_CONFIRMATION_TIMEOUT",
      false,
      undefined,
      {
        submittedTransactions: [
          {
            index: 0,
            description: preview.description,
            txHash: relayResponse.txHash,
            explorerUrl: explorerTxUrl(chainConfig.id, relayResponse.txHash),
            status: "submitted",
          },
        ],
        failedAtIndex: 0,
      },
    );
  }

  if (receipt.status !== "success") {
    throw new CLIError(
      "Relayed withdrawal reverted onchain after the relayer accepted it.",
      "CONTRACT",
      "Check the submitted transaction on a block explorer before retrying. Do not blindly resubmit the same relayer request.",
      "CONTRACT_BROADCAST_REVERTED",
      false,
      undefined,
      {
        submittedTransactions: [
          {
            index: 0,
            description: preview.description,
            txHash: relayResponse.txHash,
            explorerUrl: explorerTxUrl(chainConfig.id, relayResponse.txHash),
            status: "confirmed",
            blockNumber: receipt.blockNumber.toString(),
          },
        ],
        failedAtIndex: 0,
      },
    );
  }

  return {
    mode: "broadcast",
    broadcastMode: "relayed",
    sourceOperation: "withdraw",
    chain: chainConfig.name,
    transactions: [
      {
        index: 0,
        description: preview.description,
        txHash: relayResponse.txHash,
        blockNumber: receipt.blockNumber.toString(),
        explorerUrl: explorerTxUrl(chainConfig.id, relayResponse.txHash),
        status: "confirmed",
      },
    ],
    localStateUpdated: false,
  };
}

export async function broadcastEnvelope(
  input: unknown,
  options: {
    rpcOverride?: string;
    expectedChain?: string;
    validateOnly?: boolean;
  } = {},
): Promise<BroadcastResult> {
  const envelope = parseEnvelope(input);
  if (
    options.expectedChain
    && envelope.chain.toLowerCase() !== options.expectedChain.toLowerCase()
  ) {
    throw new CLIError(
      `Broadcast envelope targets '${envelope.chain}', but --chain requested '${options.expectedChain}'.`,
      "INPUT",
      "Drop the conflicting --chain flag or use the envelope that matches the intended chain.",
      "INPUT_BROADCAST_CHAIN_OVERRIDE_MISMATCH",
    );
  }

  const chainConfig = resolveChain(envelope.chain);

  if (envelope.operation === "withdraw" && envelope.withdrawMode === "relayed") {
    return await broadcastRelayedEnvelope(
      chainConfig,
      envelope,
      options.rpcOverride,
      options.validateOnly === true,
    );
  }

  return await broadcastSignedEnvelope(
    chainConfig,
    envelope as BroadcastableSignedEnvelope,
    options.rpcOverride,
    options.validateOnly === true,
  );
}
