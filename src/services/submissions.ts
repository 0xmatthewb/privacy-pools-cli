import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { TransactionReceiptNotFoundError } from "viem";
import { explorerTxUrl } from "../config/chains.js";
import type { GlobalOptions } from "../types.js";
import { CLIError } from "../utils/errors.js";
import { resolveChain } from "../utils/validation.js";
import {
  ensureConfigDir,
  getSubmissionsDir,
  writePrivateFileAtomic,
} from "./config.js";
import { getPublicClient } from "./sdk.js";

const SUBMISSION_RECORD_VERSION = "1";

export type SubmissionOperation = "deposit" | "withdraw" | "ragequit" | "broadcast";
export type SubmissionStatus = "submitted" | "confirmed" | "reverted";
export type SubmissionBroadcastMode = "onchain" | "relayed";
export type SubmissionBroadcastSourceOperation = "deposit" | "withdraw" | "ragequit";

export interface SubmissionTransactionRecord {
  index: number;
  description: string;
  txHash: Hex;
  explorerUrl: string | null;
  blockNumber: string | null;
  status: SubmissionStatus;
}

export interface SubmissionRecord {
  schemaVersion: typeof SUBMISSION_RECORD_VERSION;
  submissionId: string;
  createdAt: string;
  updatedAt: string;
  operation: SubmissionOperation;
  sourceCommand: string;
  chain: string;
  asset?: string | null;
  poolAccountId?: string | null;
  poolAccountNumber?: number | null;
  workflowId?: string | null;
  recipient?: string | null;
  broadcastMode?: SubmissionBroadcastMode | null;
  broadcastSourceOperation?: SubmissionBroadcastSourceOperation | null;
  status: SubmissionStatus;
  transactions: SubmissionTransactionRecord[];
  reconciliationRequired?: boolean;
  localStateSynced?: boolean;
  warningCode?: string | null;
  lastError?: {
    code: string;
    message: string;
  } | null;
}

interface CreateSubmissionRecordParams {
  submissionId?: string;
  operation: SubmissionOperation;
  sourceCommand: string;
  chain: string;
  asset?: string | null;
  poolAccountId?: string | null;
  poolAccountNumber?: number | null;
  workflowId?: string | null;
  recipient?: string | null;
  broadcastMode?: SubmissionBroadcastMode | null;
  broadcastSourceOperation?: SubmissionBroadcastSourceOperation | null;
  transactions: Array<{
    description: string;
    txHash: Hex;
  }>;
}

function getSubmissionFilePath(submissionId: string): string {
  return join(getSubmissionsDir(), `${submissionId}.json`);
}

function parseSubmissionRecord(raw: string, filePath: string): SubmissionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CLIError(
      `Submission record is corrupt or unreadable: ${filePath}`,
      "INPUT",
      "Remove the broken submission file or resolve the JSON manually, then retry.",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new CLIError(
      `Submission record has invalid structure: ${filePath}`,
      "INPUT",
      "Remove the broken submission file or resolve the JSON manually, then retry.",
    );
  }

  const record = parsed as SubmissionRecord;
  if (
    typeof record.submissionId !== "string" ||
    typeof record.operation !== "string" ||
    typeof record.chain !== "string" ||
    !Array.isArray(record.transactions)
  ) {
    throw new CLIError(
      `Submission record has invalid structure: ${filePath}`,
      "INPUT",
      "Remove the broken submission file or resolve the JSON manually, then retry.",
    );
  }

  return normalizeSubmissionRecord(record);
}

export function normalizeSubmissionRecord(record: SubmissionRecord): SubmissionRecord {
  const normalizedTransactions = record.transactions.map((transaction, index) => ({
    index,
    description: transaction.description,
    txHash: transaction.txHash,
    explorerUrl: transaction.explorerUrl ?? null,
    blockNumber: transaction.blockNumber ?? null,
    status: transaction.status ?? "submitted",
  }));
  const status = normalizedTransactions.some((transaction) => transaction.status === "reverted")
    ? "reverted"
    : normalizedTransactions.every((transaction) => transaction.status === "confirmed")
      ? "confirmed"
      : "submitted";

  return {
    ...record,
    schemaVersion: SUBMISSION_RECORD_VERSION,
    asset: record.asset ?? null,
    poolAccountId: record.poolAccountId ?? null,
    poolAccountNumber: record.poolAccountNumber ?? null,
    workflowId: record.workflowId ?? null,
    recipient: record.recipient ?? null,
    broadcastMode: record.broadcastMode ?? null,
    broadcastSourceOperation: record.broadcastSourceOperation ?? null,
    reconciliationRequired: record.reconciliationRequired ?? false,
    localStateSynced: record.localStateSynced ?? false,
    warningCode: record.warningCode ?? null,
    lastError: record.lastError ?? null,
    status,
    transactions: normalizedTransactions,
  };
}

export function saveSubmissionRecord(record: SubmissionRecord): SubmissionRecord {
  ensureConfigDir();
  const normalized = normalizeSubmissionRecord(record);
  writePrivateFileAtomic(
    getSubmissionFilePath(normalized.submissionId),
    JSON.stringify(normalized, null, 2),
  );
  return normalized;
}

export function createSubmissionRecord(
  params: CreateSubmissionRecordParams,
): SubmissionRecord {
  const now = new Date().toISOString();
  return saveSubmissionRecord({
    schemaVersion: SUBMISSION_RECORD_VERSION,
    submissionId: params.submissionId ?? randomUUID(),
    createdAt: now,
    updatedAt: now,
    operation: params.operation,
    sourceCommand: params.sourceCommand,
    chain: params.chain,
    asset: params.asset ?? null,
    poolAccountId: params.poolAccountId ?? null,
    poolAccountNumber: params.poolAccountNumber ?? null,
    workflowId: params.workflowId ?? null,
    recipient: params.recipient ?? null,
    broadcastMode: params.broadcastMode ?? null,
    broadcastSourceOperation: params.broadcastSourceOperation ?? null,
    status: "submitted",
    transactions: params.transactions.map((transaction, index) => ({
      index,
      description: transaction.description,
      txHash: transaction.txHash,
      explorerUrl: null,
      blockNumber: null,
      status: "submitted",
    })),
    reconciliationRequired: false,
    localStateSynced: false,
    warningCode: null,
    lastError: null,
  });
}

export function loadSubmissionRecord(submissionId: string): SubmissionRecord {
  const filePath = getSubmissionFilePath(submissionId);
  if (!existsSync(filePath)) {
    throw new CLIError(
      `Unknown submission: ${submissionId}`,
      "INPUT",
      "Run the original command with --no-wait first, then use the returned submissionId with tx-status.",
      "INPUT_UNKNOWN_SUBMISSION",
    );
  }
  return parseSubmissionRecord(readFileSync(filePath, "utf-8"), filePath);
}

export function updateSubmissionRecord(
  submissionId: string,
  patch: Partial<SubmissionRecord>,
): SubmissionRecord {
  const current = loadSubmissionRecord(submissionId);
  return saveSubmissionRecord({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export async function refreshSubmissionRecord(
  submissionId: string,
  globalOpts?: Pick<GlobalOptions, "rpcUrl">,
): Promise<SubmissionRecord> {
  const current = loadSubmissionRecord(submissionId);
  const chainConfig = resolveChain(current.chain);
  const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
  let mutated = false;
  const refreshedTransactions: SubmissionTransactionRecord[] = [];

  for (const transaction of current.transactions) {
    if (transaction.status !== "submitted") {
      refreshedTransactions.push(transaction);
      continue;
    }

    try {
      const receipt = await publicClient.getTransactionReceipt({
        hash: transaction.txHash,
      });
      mutated = true;
      refreshedTransactions.push({
        ...transaction,
        explorerUrl: explorerTxUrl(chainConfig.id, transaction.txHash),
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status === "success" ? "confirmed" : "reverted",
      });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) {
        refreshedTransactions.push({
          ...transaction,
          explorerUrl:
            transaction.explorerUrl ?? explorerTxUrl(chainConfig.id, transaction.txHash),
        });
        continue;
      }
      throw error;
    }
  }

  if (!mutated) {
    return saveSubmissionRecord({
      ...current,
      transactions: refreshedTransactions,
      updatedAt: new Date().toISOString(),
    });
  }

  return saveSubmissionRecord({
    ...current,
    transactions: refreshedTransactions,
    updatedAt: new Date().toISOString(),
  });
}

export function listSubmissionIds(): string[] {
  const dir = getSubmissionsDir();
  if (!existsSync(dir)) {
    return [];
  }

  const ids: Array<{ id: string; mtimeMs: number }> = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(dir, entry);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { submissionId?: unknown; updatedAt?: unknown };
      if (typeof parsed.submissionId !== "string") continue;
      const mtimeMs = typeof parsed.updatedAt === "string"
        ? Date.parse(parsed.updatedAt)
        : Number.NaN;
      ids.push({
        id: parsed.submissionId,
        mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
      });
    } catch {
      // Ignore unreadable records here; tx-status itself still fails strictly.
    }
  }

  return ids
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map((entry) => entry.id);
}
