import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ensureConfigDir, getConfigDir, writePrivateFileAtomic } from "./config.js";

interface RecipientHistoryFile {
  version: 1;
  recipients: string[];
}

function recipientHistoryPath(): string {
  return join(getConfigDir(), "known-recipients.json");
}

function parseRecipientHistory(raw: string): string[] {
  const parsed = JSON.parse(raw) as Partial<RecipientHistoryFile>;
  if (!Array.isArray(parsed.recipients)) return [];
  return parsed.recipients.filter((entry): entry is string => typeof entry === "string");
}

export function loadKnownRecipientHistory(): string[] {
  const path = recipientHistoryPath();
  if (!existsSync(path)) return [];
  try {
    return parseRecipientHistory(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

export function rememberKnownRecipient(address: string): void {
  ensureConfigDir();
  const recipients = new Set(loadKnownRecipientHistory().map((entry) => entry.toLowerCase()));
  recipients.add(address.toLowerCase());
  const payload: RecipientHistoryFile = {
    version: 1,
    recipients: [...recipients].sort(),
  };
  writePrivateFileAtomic(recipientHistoryPath(), `${JSON.stringify(payload, null, 2)}\n`);
}
