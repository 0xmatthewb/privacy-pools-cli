import { describe, expect, test } from "bun:test";
import { createTempHome, parseJsonOutput, runBuiltCli } from "../helpers/cli.ts";

interface RecipientEnvelope {
  success: boolean;
  mode: "recipients";
  action?: "add" | "list" | "remove" | "clear";
  operation: "recipients.add" | "recipients.list" | "recipients.remove" | "recipients.clear";
  address?: string;
  count?: number;
  removed?: boolean;
  removedCount?: number;
  recipient?: { address: string; label: string | null };
  chain?: string;
  recipients?: Array<{
    address: string;
    label: string | null;
    updatedAt?: string;
  }>;
}

describe("recipients command integration", () => {
  test("root recipients add/list/remove/clear works in agent mode", () => {
    const home = createTempHome("pp-recipients-cli-");
    const first = "0x1111111111111111111111111111111111111111";
    const second = "0x2222222222222222222222222222222222222222";

    const addFirst = runBuiltCli(
      ["--agent", "recipients", "add", first, "treasury"],
      { home },
    );
    expect(addFirst.status).toBe(0);
    expect(addFirst.stderr).toBe("");
    expect(parseJsonOutput<RecipientEnvelope>(addFirst.stdout)).toMatchObject({
      success: true,
      action: "add",
      operation: "recipients.add",
      recipient: { address: first, label: "treasury" },
    });

    const listOne = runBuiltCli(["--agent", "recipients", "list"], { home });
    expect(listOne.status).toBe(0);
    expect(parseJsonOutput<RecipientEnvelope>(listOne.stdout)).toMatchObject({
      success: true,
      action: "list",
      operation: "recipients.list",
      chain: "mainnet",
      count: 1,
      recipients: [{ address: first, label: "treasury" }],
    });
    expect(parseJsonOutput<RecipientEnvelope>(listOne.stdout).recipients?.[0]?.updatedAt).toBeUndefined();

    const removeByLabel = runBuiltCli(
      ["--agent", "recipients", "remove", "treasury"],
      { home },
    );
    expect(removeByLabel.status).toBe(0);
    expect(parseJsonOutput<RecipientEnvelope>(removeByLabel.stdout)).toMatchObject({
      success: true,
      action: "remove",
      operation: "recipients.remove",
      address: first,
      removed: true,
    });

    const addSecond = runBuiltCli(
      ["--agent", "recipients", "add", second, "vitalik.eth"],
      { home },
    );
    expect(addSecond.status).toBe(0);

    const removeByStoredName = runBuiltCli(
      ["--agent", "recipients", "remove", "vitalik.eth"],
      { home },
    );
    expect(removeByStoredName.status).toBe(0);
    expect(parseJsonOutput<RecipientEnvelope>(removeByStoredName.stdout)).toMatchObject({
      success: true,
      action: "remove",
      operation: "recipients.remove",
      address: second,
      removed: true,
    });

    const addBeforeClear = runBuiltCli(
      ["--agent", "recipients", "add", second, "ops"],
      { home },
    );
    expect(addBeforeClear.status).toBe(0);

    const clear = runBuiltCli(["--agent", "recipients", "clear"], { home });
    expect(clear.status).toBe(0);
    expect(parseJsonOutput<RecipientEnvelope>(clear.stdout)).toMatchObject({
      success: true,
      action: "clear",
      operation: "recipients.clear",
      removedCount: 1,
    });

    const listEmpty = runBuiltCli(["--agent", "recipients"], { home });
    expect(listEmpty.status).toBe(0);
    expect(parseJsonOutput<RecipientEnvelope>(listEmpty.stdout)).toMatchObject({
      success: true,
      action: "list",
      operation: "recipients.list",
      count: 0,
      recipients: [],
    });
  });
});
