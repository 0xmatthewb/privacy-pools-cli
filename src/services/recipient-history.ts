import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getAddress } from "viem";
import { ensureConfigDir, getConfigDir, writePrivateFileAtomic } from "./config.js";

export type RecipientHistorySource = "legacy" | "manual" | "withdrawal";

export interface RecipientHistoryEntry {
  address: string;
  label?: string;
  ensName?: string;
  chain?: string;
  source: RecipientHistorySource;
  useCount: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
  updatedAt: string;
}

interface LegacyRecipientHistoryFile {
  version: 1;
  recipients: string[];
}

interface RecipientHistoryFile {
  version: 2;
  updatedAt: string;
  recipients: RecipientHistoryEntry[];
}

export function recipientHistoryPath(): string {
  return join(getConfigDir(), "known-recipients.json");
}

function normalizeRecipientAddress(address: string): string {
  const trimmed = address.trim();
  try {
    return getAddress(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSource(value: unknown): RecipientHistorySource {
  return value === "manual" || value === "withdrawal" || value === "legacy"
    ? value
    : "legacy";
}

function normalizeRecipientEntry(
  value: unknown,
  fallbackUpdatedAt: string,
): RecipientHistoryEntry | null {
  if (typeof value === "string") {
    return {
      address: normalizeRecipientAddress(value),
      source: "legacy",
      useCount: 0,
      firstUsedAt: null,
      lastUsedAt: null,
      updatedAt: fallbackUpdatedAt,
    };
  }

  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<RecipientHistoryEntry>;
  if (typeof candidate.address !== "string" || !candidate.address.trim()) {
    return null;
  }

  const updatedAt =
    normalizeTimestamp(candidate.updatedAt) ?? fallbackUpdatedAt;
  return {
    address: normalizeRecipientAddress(candidate.address),
    ...(normalizeOptionalText(candidate.label)
      ? { label: normalizeOptionalText(candidate.label) }
      : {}),
    ...(normalizeOptionalText(candidate.ensName)
      ? { ensName: normalizeOptionalText(candidate.ensName) }
      : {}),
    ...(normalizeOptionalText(candidate.chain)
      ? { chain: normalizeOptionalText(candidate.chain) }
      : {}),
    source: normalizeSource(candidate.source),
    useCount:
      typeof candidate.useCount === "number" &&
      Number.isFinite(candidate.useCount) &&
      candidate.useCount > 0
        ? Math.floor(candidate.useCount)
        : 0,
    firstUsedAt: normalizeTimestamp(candidate.firstUsedAt),
    lastUsedAt: normalizeTimestamp(candidate.lastUsedAt),
    updatedAt,
  };
}

function parseRecipientHistory(raw: string): RecipientHistoryEntry[] {
  const parsed = JSON.parse(raw) as
    | Partial<RecipientHistoryFile>
    | Partial<LegacyRecipientHistoryFile>;
  if (!Array.isArray(parsed.recipients)) return [];
  const fallbackUpdatedAt =
    typeof (parsed as Partial<RecipientHistoryFile>).updatedAt === "string"
      ? normalizeTimestamp((parsed as Partial<RecipientHistoryFile>).updatedAt) ?? new Date(0).toISOString()
      : new Date(0).toISOString();
  const byAddress = new Map<string, RecipientHistoryEntry>();
  for (const rawEntry of parsed.recipients) {
    const entry = normalizeRecipientEntry(rawEntry, fallbackUpdatedAt);
    if (!entry) continue;
    byAddress.set(entry.address.toLowerCase(), entry);
  }
  return sortRecipientHistoryEntries([...byAddress.values()]);
}

function sortRecipientHistoryEntries(
  recipients: RecipientHistoryEntry[],
): RecipientHistoryEntry[] {
  return [...recipients].sort((a, b) => {
    const aTime = a.lastUsedAt ?? a.updatedAt;
    const bTime = b.lastUsedAt ?? b.updatedAt;
    if (aTime !== bTime) return bTime.localeCompare(aTime);
    if (a.useCount !== b.useCount) return b.useCount - a.useCount;
    return a.address.localeCompare(b.address);
  });
}

function writeRecipientHistory(
  recipients: readonly RecipientHistoryEntry[],
  nowIso = new Date().toISOString(),
): void {
  ensureConfigDir();
  const payload: RecipientHistoryFile = {
    version: 2,
    updatedAt: nowIso,
    recipients: sortRecipientHistoryEntries([...recipients]),
  };
  writePrivateFileAtomic(recipientHistoryPath(), `${JSON.stringify(payload, null, 2)}\n`);
}

export function loadRecipientHistoryEntries(): RecipientHistoryEntry[] {
  const path = recipientHistoryPath();
  if (!existsSync(path)) return [];
  try {
    return parseRecipientHistory(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export function loadKnownRecipientHistory(): string[] {
  return loadRecipientHistoryEntries().map((entry) => entry.address);
}

export function upsertRecipientHistoryEntry(params: {
  address: string;
  label?: string | null;
  ensName?: string | null;
  chain?: string | null;
  source?: RecipientHistorySource;
  incrementUseCount?: boolean;
  now?: Date;
}): RecipientHistoryEntry {
  const address = normalizeRecipientAddress(params.address);
  const nowIso = (params.now ?? new Date()).toISOString();
  const recipients = loadRecipientHistoryEntries();
  const existingIndex = recipients.findIndex(
    (entry) => entry.address.toLowerCase() === address.toLowerCase(),
  );
  const existing = existingIndex >= 0 ? recipients[existingIndex] : undefined;
  const incrementUseCount = params.incrementUseCount ?? false;
  const source = params.source ?? existing?.source ?? "manual";
  const next: RecipientHistoryEntry = {
    address,
    ...(existing?.label ? { label: existing.label } : {}),
    ...(existing?.ensName ? { ensName: existing.ensName } : {}),
    ...(existing?.chain ? { chain: existing.chain } : {}),
    source,
    useCount: (existing?.useCount ?? 0) + (incrementUseCount ? 1 : 0),
    firstUsedAt:
      existing?.firstUsedAt ??
      (incrementUseCount ? nowIso : null),
    lastUsedAt:
      incrementUseCount ? nowIso : existing?.lastUsedAt ?? null,
    updatedAt: nowIso,
  };

  const label = normalizeOptionalText(params.label);
  if (label) next.label = label;
  const ensName = normalizeOptionalText(params.ensName);
  if (ensName) next.ensName = ensName;
  const chain = normalizeOptionalText(params.chain);
  if (chain) next.chain = chain;

  if (existingIndex >= 0) {
    recipients[existingIndex] = next;
  } else {
    recipients.push(next);
  }
  writeRecipientHistory(recipients, nowIso);
  return next;
}

export function rememberKnownRecipient(
  address: string,
  metadata: {
    ensName?: string | null;
    chain?: string | null;
    label?: string | null;
  } = {},
): RecipientHistoryEntry {
  return upsertRecipientHistoryEntry({
    address,
    ...metadata,
    source: "withdrawal",
    incrementUseCount: true,
  });
}

export function removeRecipientHistoryEntry(address: string): boolean {
  const normalized = normalizeRecipientAddress(address);
  const recipients = loadRecipientHistoryEntries();
  const next = recipients.filter(
    (entry) => entry.address.toLowerCase() !== normalized.toLowerCase(),
  );
  if (next.length === recipients.length) {
    return false;
  }
  writeRecipientHistory(next);
  return true;
}

export function clearRecipientHistory(): number {
  const recipients = loadRecipientHistoryEntries();
  if (recipients.length === 0) {
    return 0;
  }
  try {
    unlinkSync(recipientHistoryPath());
  } catch {
    writeRecipientHistory([]);
  }
  return recipients.length;
}
