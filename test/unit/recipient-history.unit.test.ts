import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearRecipientHistory,
  loadKnownRecipientHistory,
  loadRecipientHistoryEntries,
  recipientHistoryPath,
  rememberKnownRecipient,
  removeRecipientHistoryEntry,
  upsertRecipientHistoryEntry,
} from "../../src/services/recipient-history.ts";
import { setActiveProfile } from "../../src/runtime/config-paths.ts";
import {
  cleanupTrackedTempDir,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

let tempHome: string;

beforeEach(() => {
  tempHome = createTrackedTempDir("pp-recipient-history-");
  process.env.PRIVACY_POOLS_HOME = tempHome;
  setActiveProfile(undefined);
});

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  setActiveProfile(undefined);
  cleanupTrackedTempDir(tempHome);
});

describe("recipient history", () => {
  test("loads legacy v1 recipient arrays", () => {
    mkdirSync(tempHome, { recursive: true });
    writeFileSync(
      join(tempHome, "known-recipients.json"),
      JSON.stringify({
        version: 1,
        recipients: [
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222",
        ],
      }),
    );

    expect(loadKnownRecipientHistory()).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);
    expect(loadRecipientHistoryEntries()[0]).toMatchObject({
      source: "legacy",
      useCount: 0,
    });
  });

  test("remembers successful withdrawals with metadata and use counts", () => {
    const address = "0x3333333333333333333333333333333333333333";

    rememberKnownRecipient(address, {
      ensName: "alice.eth",
      chain: "mainnet",
    });
    rememberKnownRecipient(address, {
      chain: "arbitrum",
    });

    const entries = loadRecipientHistoryEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      address,
      ensName: "alice.eth",
      chain: "arbitrum",
      source: "withdrawal",
      useCount: 2,
    });

    const raw = JSON.parse(readFileSync(recipientHistoryPath(), "utf8"));
    expect(raw.version).toBe(2);
  });

  test("supports manual add, remove, and clear operations", () => {
    const first = "0x4444444444444444444444444444444444444444";
    const second = "0x5555555555555555555555555555555555555555";

    upsertRecipientHistoryEntry({
      address: first,
      label: "cold wallet",
      source: "manual",
    });
    upsertRecipientHistoryEntry({
      address: second,
      source: "manual",
    });

    expect(loadRecipientHistoryEntries()).toHaveLength(2);
    expect(removeRecipientHistoryEntry(first)).toBe(true);
    expect(removeRecipientHistoryEntry(first)).toBe(false);
    expect(loadKnownRecipientHistory()).toEqual([second]);
    expect(clearRecipientHistory()).toBe(1);
    expect(loadRecipientHistoryEntries()).toEqual([]);
  });
});
