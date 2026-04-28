import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Command } from "commander";
import {
  collectKnownWithdrawalRecipients,
  confirmRecipientIfNew,
  handleWithdrawRecipientsAddCommand,
  handleWithdrawRecipientsClearCommand,
  handleWithdrawRecipientsListCommand,
  handleWithdrawRecipientsRemoveCommand,
  rememberSuccessfulWithdrawalRecipient,
  validateRecipientAddressOrEnsInput,
} from "../../src/commands/withdraw/recipients.ts";
import { setActiveProfile } from "../../src/runtime/config-paths.ts";
import {
  loadRecipientHistoryEntries,
  upsertRecipientHistoryEntry,
} from "../../src/services/recipient-history.ts";
import {
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import { createTestWorld, type TestWorld } from "../helpers/test-world.ts";

interface RecipientEnvelope {
  success: boolean;
  mode: "recipient-history";
  operation: "add" | "list" | "remove" | "clear";
  chain?: string;
  count?: number;
  removed?: boolean;
  removedCount?: number;
  address?: string;
  recipient?: {
    address: string;
    label: string | null;
    ensName: string | null;
    chain: string | null;
    firstUsedAt?: string | null;
    updatedAt?: string;
  };
  recipients?: Array<{
    address: string;
    label: string | null;
    ensName: string | null;
    chain: string | null;
    updatedAt?: string;
  }>;
  nextActions?: Array<{ command: string; runnable?: boolean }>;
  deprecationWarning?: {
    code: string;
    replacementCommand: string;
  };
  errorCode?: string;
}

let world: TestWorld;
const originalArgv = [...process.argv];

function fakeRecipientCommand(
  globalOpts: Record<string, unknown> = {},
  names: string[] = ["recipients", "list"],
): Command {
  const root = {
    parent: undefined,
    name: () => "privacy-pools",
    opts: () => globalOpts,
  };
  let parent: Record<string, unknown> = root;
  for (const name of names) {
    parent = {
      parent,
      name: () => name,
      opts: () => ({}),
    };
  }
  return parent as unknown as Command;
}

beforeEach(() => {
  world = createTestWorld({ prefix: "pp-recipients-command-" });
  world.useConfigHome();
  setActiveProfile(undefined);
  process.argv = [...originalArgv];
});

afterEach(async () => {
  setActiveProfile(undefined);
  process.argv = [...originalArgv];
  await world.teardown();
});

describe("withdraw recipient command handlers", () => {
  test("recipient helpers validate inputs and remember best-effort recipients", async () => {
    const signer = "0x9999999999999999999999999999999999999999";
    const recipient = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    expect(validateRecipientAddressOrEnsInput(recipient)).toBe(true);
    expect(validateRecipientAddressOrEnsInput("alice.eth")).toBe(true);
    expect(validateRecipientAddressOrEnsInput("not a recipient")).toContain(
      "Invalid",
    );

    await expect(
      confirmRecipientIfNew({
        address: signer,
        knownRecipients: [signer],
        skipPrompts: false,
        silent: true,
      }),
    ).resolves.toEqual([]);
    const warnings = await confirmRecipientIfNew({
      address: recipient,
      knownRecipients: [signer],
      skipPrompts: true,
      silent: true,
    });
    expect(warnings[0]?.code).toBe("RECIPIENT_NEW_TO_PROFILE");

    rememberSuccessfulWithdrawalRecipient(recipient);
    rememberSuccessfulWithdrawalRecipient(signer, {
      chain: "mainnet",
      label: "signer",
    });
    const knownRecipients = collectKnownWithdrawalRecipients(signer, "mainnet")
      .map((entry) => entry.toLowerCase());
    expect(knownRecipients).toEqual(
      expect.arrayContaining([signer.toLowerCase(), recipient.toLowerCase()]),
    );
  });

  test("add, list, remove, and clear recipients in JSON mode with chain partitioning", async () => {
    const first = "0x1111111111111111111111111111111111111111";
    const second = "0x2222222222222222222222222222222222222222";

    const addFirst = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(
      () =>
        handleWithdrawRecipientsAddCommand(
          first,
          "treasury",
          { includeMetadata: true },
          fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
            "recipients",
            "add",
          ]),
        ),
    );
    expect(addFirst.exitCode).toBe(0);
    expect(addFirst.stderr).toBe("");
    expect(addFirst.json).toMatchObject({
      success: true,
      operation: "add",
      recipient: {
        address: first,
        label: "treasury",
        chain: "mainnet",
      },
    });
    expect(typeof addFirst.json.recipient?.updatedAt).toBe("string");

    await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(() =>
      handleWithdrawRecipientsAddCommand(
        second,
        undefined,
        { label: "ops", includeMetadata: true },
        fakeRecipientCommand({ agent: true, chain: "optimism" }, [
          "recipients",
          "add",
        ]),
      ),
    );

    const listMainnet = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(
      () =>
        handleWithdrawRecipientsListCommand(
          { limit: "1", includeMetadata: true },
          fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
            "recipients",
            "list",
          ]),
        ),
    );
    expect(listMainnet.json).toMatchObject({
      success: true,
      operation: "list",
      chain: "mainnet",
      count: 1,
      recipients: [{ address: first, label: "treasury", chain: "mainnet" }],
    });
    expect(typeof listMainnet.json.recipients?.[0]?.updatedAt).toBe("string");

    const listAll = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(
      () =>
        handleWithdrawRecipientsListCommand(
          { allChains: true },
          fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
            "recipients",
            "list",
          ]),
        ),
    );
    expect(listAll.json.chain).toBe("all-chains");
    expect(listAll.json.count).toBe(2);
    expect(listAll.json.recipients?.map((entry) => entry.address).sort()).toEqual(
      [first, second],
    );

    const removeByLabel = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(
      () =>
        handleWithdrawRecipientsRemoveCommand(
          "treasury",
          {},
          fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
            "recipients",
            "remove",
          ]),
        ),
    );
    expect(removeByLabel.json).toMatchObject({
      success: true,
      operation: "remove",
      address: first,
      removed: true,
    });

    const clearOptimism = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(
      () =>
        handleWithdrawRecipientsClearCommand(
          {},
          fakeRecipientCommand({ agent: true, chain: "optimism" }, [
            "recipients",
            "clear",
          ]),
        ),
    );
    expect(clearOptimism.json).toMatchObject({
      success: true,
      operation: "clear",
      removedCount: 1,
    });
    expect(loadRecipientHistoryEntries()).toEqual([]);
  });

  test("empty JSON lists include a template next action", async () => {
    const empty = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(() =>
      handleWithdrawRecipientsListCommand(
        {},
        fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
          "recipients",
          "list",
        ]),
      ),
    );

    expect(empty.json).toMatchObject({
      success: true,
      operation: "list",
      count: 0,
      recipients: [],
    });
    expect(empty.json.nextActions?.[0]).toMatchObject({
      command: "recipients add",
      runnable: false,
    });
  });

  test("human empty lists and no-config command chains fall back cleanly", async () => {
    const human = await captureAsyncOutput(() =>
      handleWithdrawRecipientsListCommand(
        {},
        fakeRecipientCommand({}, ["recipients", "list"]),
      ),
    );

    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("No remembered withdrawal recipients yet.");
    expect(human.stderr).toContain("recipients add <address>");

    const json = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(() =>
      handleWithdrawRecipientsListCommand(
        {},
        fakeRecipientCommand({ agent: true }, ["recipients", "list"]),
      ),
    );
    expect(json.json.chain).toBe("mainnet");
  });

  test("human and CSV list renderers expose saved recipients", async () => {
    const first = "0x3333333333333333333333333333333333333333";
    upsertRecipientHistoryEntry({
      address: first,
      label: "vault",
      chain: "mainnet",
      source: "manual",
      incrementUseCount: true,
    });

    const human = await captureAsyncOutput(() =>
      handleWithdrawRecipientsListCommand(
        {},
        fakeRecipientCommand({ chain: "mainnet" }, ["recipients", "list"]),
      ),
    );
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("Withdrawal recipients (mainnet)");
    expect(human.stderr).toContain("vault");
    expect(human.stderr).toContain(first);

    const csv = await captureAsyncOutput(() =>
      handleWithdrawRecipientsListCommand(
        {},
        fakeRecipientCommand({ output: "csv", chain: "mainnet" }, [
          "recipients",
          "list",
        ]),
      ),
    );
    expect(csv.stdout).toContain("Address,Label,ENS,Chain");
    expect(csv.stdout).toContain(`${first},vault,,mainnet`);
    expect(csv.stderr).toBe("");
  });

  test("withdraw-recipient aliases carry deprecation metadata", async () => {
    const address = "0x4444444444444444444444444444444444444444";
    await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawRecipientsAddCommand(
        address,
        "legacy",
        {},
        fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
          "withdraw",
          "recipients",
          "add",
        ]),
      ),
    );

    process.argv = [
      "node",
      "privacy-pools",
      "withdraw",
      "recipients",
      "list",
    ];
    const list = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(() =>
      handleWithdrawRecipientsListCommand(
        {},
        fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
          "withdraw",
          "recipients",
          "list",
        ]),
      ),
    );

    expect(list.json.deprecationWarning).toMatchObject({
      code: "COMMAND_ALIAS_DEPRECATED",
      replacementCommand: "privacy-pools recipients",
    });
  });

  test("recents aliases carry deprecation metadata for root and nested commands", async () => {
    process.argv = ["node", "privacy-pools", "recents", "list"];
    const root = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(() =>
      handleWithdrawRecipientsListCommand(
        {},
        fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
          "recipients",
          "list",
        ]),
      ),
    );
    expect(root.json.deprecationWarning?.replacementCommand).toBe(
      "privacy-pools recipients",
    );

    process.argv = ["node", "privacy-pools", "withdraw", "recents", "list"];
    const nested = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(() =>
      handleWithdrawRecipientsListCommand(
        {},
        fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
          "withdraw",
          "recipients",
          "list",
        ]),
      ),
    );
    expect(nested.json.deprecationWarning?.replacementCommand).toBe(
      "privacy-pools withdraw recipients",
    );
  });

  test("human add, remove, and clear render status messages", async () => {
    const address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const other = "0xcccccccccccccccccccccccccccccccccccccccc";

    const add = await captureAsyncOutput(() =>
      handleWithdrawRecipientsAddCommand(
        address,
        "desk",
        {},
        fakeRecipientCommand({ chain: "mainnet" }, ["recipients", "add"]),
      ),
    );
    expect(add.stdout).toBe("");
    expect(add.stderr).toContain("Remembered recipient");

    upsertRecipientHistoryEntry({
      address: other,
      label: "ops",
      chain: "mainnet",
      source: "manual",
    });
    const removeByIndex = await captureAsyncOutput(() =>
      handleWithdrawRecipientsRemoveCommand(
        "1",
        {},
        fakeRecipientCommand({ chain: "mainnet" }, ["recipients", "remove"]),
      ),
    );
    expect(removeByIndex.stderr).toContain("Removed recipient");

    const missing = await captureAsyncOutput(() =>
      handleWithdrawRecipientsRemoveCommand(
        address,
        {},
        fakeRecipientCommand({ chain: "optimism" }, ["recipients", "remove"]),
      ),
    );
    expect(missing.stderr).toContain("was not remembered");

    const clear = await captureAsyncOutput(() =>
      handleWithdrawRecipientsClearCommand(
        {},
        fakeRecipientCommand({ chain: "mainnet" }, ["recipients", "clear"]),
      ),
    );
    expect(clear.stderr).toContain("Cleared");
  });

  test("validation and output-mode errors are reported through command error handling", async () => {
    await expect(
      handleWithdrawRecipientsListCommand(
        { limit: "0" },
        fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
          "recipients",
          "list",
        ]),
      ),
    ).rejects.toThrow("Invalid --limit value");

    const invalidRecipient = await captureAsyncJsonOutputAllowExit<RecipientEnvelope>(
      () =>
        handleWithdrawRecipientsAddCommand(
          "0x0000000000000000000000000000000000000000",
          undefined,
          {},
          fakeRecipientCommand({ agent: true, chain: "mainnet" }, [
            "recipients",
            "add",
          ]),
        ),
    );
    expect(invalidRecipient.exitCode).toBe(2);
    expect(invalidRecipient.json.success).toBe(false);
    expect(invalidRecipient.json.errorCode).toBe("INPUT_BAD_ADDRESS");

    const csvAdd = await captureAsyncOutputAllowExit(() =>
      handleWithdrawRecipientsAddCommand(
        "0x5555555555555555555555555555555555555555",
        undefined,
        {},
        fakeRecipientCommand({ output: "csv", chain: "mainnet" }, [
          "recipients",
          "add",
        ]),
      ),
    );
    expect(csvAdd.exitCode).toBe(2);
    expect(csvAdd.stdout).toBe("");
    expect(csvAdd.stderr).toContain("--output csv is not supported");
  });
});
