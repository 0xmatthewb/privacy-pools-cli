import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { EXIT_CODES } from "../../src/utils/errors.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

const CONTRACT_DOC_PATH =
  `${CLI_ROOT}/docs/contracts/cli-json-contract.v1.3.0.json`;

interface ContractDoc {
  version: string;
  schemaVersion: string;
  exitCodes: Record<string, string>;
  shared?: {
    rawUnsignedTransaction?: Record<string, string>;
  };
  commands: Record<string, unknown>;
  unsignedCalldataABIs: Record<string, string>;
}

describe("external JSON contract doc conformance", () => {
  test("doc version is explicit and aligned with runtime schema version", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    expect(doc.version).toBe("1.3.0");
    expect(doc.schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });

  test("doc includes the full exit code map used by runtime", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    expect(doc.exitCodes).toEqual({
      "0": "SUCCESS",
      [String(EXIT_CODES.UNKNOWN)]: "UNKNOWN_ERROR",
      [String(EXIT_CODES.INPUT)]: "INPUT_ERROR",
      [String(EXIT_CODES.RPC)]: "RPC_ERROR",
      [String(EXIT_CODES.ASP)]: "ASP_ERROR",
      [String(EXIT_CODES.RELAYER)]: "RELAYER_ERROR",
      [String(EXIT_CODES.PROOF)]: "PROOF_ERROR",
      [String(EXIT_CODES.CONTRACT)]: "CONTRACT_ERROR",
    });
  });

  test("doc includes unsigned output variants and ABI signatures", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;

    expect("deposit" in doc.commands).toBe(true);
    expect("withdraw" in doc.commands).toBe(true);
    expect("ragequit" in doc.commands).toBe(true);

    expect(doc.unsignedCalldataABIs.depositNative).toContain("function deposit(uint256 _precommitment)");
    expect(doc.unsignedCalldataABIs.depositErc20).toContain("function deposit(address _asset");
    expect(doc.unsignedCalldataABIs.approveErc20).toContain("function approve(address spender");
    expect(doc.unsignedCalldataABIs.withdrawDirect).toContain("function withdraw(");
    expect(doc.unsignedCalldataABIs.withdrawRelayed).toContain("function relay(");
    expect(doc.unsignedCalldataABIs.ragequit).toContain("function ragequit(");
    expect(doc.shared?.rawUnsignedTransaction?.valueHex).toBe(
      "0x-prefixed-hex-quantity-wei"
    );
  });

  test("doc reflects current init/status/help machine envelopes", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const init = commands.init as { successFields?: Record<string, string> };
    expect(init.successFields?.defaultChain).toBe("string");
    expect(init.successFields?.signerKeySet).toBe("boolean");
    expect(init.successFields?.recoveryPhraseRedacted).toContain("boolean?");
    expect(init.successFields?.recoveryPhrase).toContain("--show-mnemonic");

    const status = commands.status as { successFields?: Record<string, string> };
    expect(status.successFields?.selectedChain).toBe("string|null");
    expect(status.successFields?.recoveryPhraseSet).toBe("boolean");

    const meta = commands.meta as Record<string, unknown>;
    expect(meta.helpEnvelope).toBeTruthy();
    expect(meta.versionEnvelope).toBeTruthy();
  });

  test("doc reflects current activity/accounts/stats machine fields", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const activity = commands.activity as { successFields?: Record<string, string> };
    expect(activity.successFields?.chain).toContain("\"all-mainnets\"");
    expect(activity.successFields?.chainFiltered).toContain("boolean?");
    expect(activity.successFields?.note).toContain("string?");

    const accounts = commands.accounts as { accountFields?: Record<string, string> };
    expect(accounts.accountFields?.aspStatus).toContain("\"declined\"");
    expect(accounts.accountFields?.aspStatus).toContain("\"unknown\"");
    expect((accounts as { summaryVariant?: Record<string, string> }).summaryVariant?.declinedCount).toBe("number");
    expect((accounts as { summaryVariant?: Record<string, string> }).summaryVariant?.approvedCount).toBe("number");
    expect((accounts as { pendingOnlyVariant?: Record<string, string> }).pendingOnlyVariant?.accounts).toContain("\"pending\"");

    const stats = commands.stats as { timeBasedStatisticsFields?: Record<string, string> };
    expect(stats.timeBasedStatisticsFields?.totalDepositsValue).toBe("decimal-string-wei|null");
    expect(stats.timeBasedStatisticsFields?.totalDepositsValueUsd).toBe("string|null");
    expect(stats.timeBasedStatisticsFields?.totalWithdrawalsValue).toBe("decimal-string-wei|null");
    expect(stats.timeBasedStatisticsFields?.totalWithdrawalsValueUsd).toBe("string|null");

    const capabilities = commands.capabilities as { successFields?: Record<string, string> };
    expect(capabilities.successFields?.commandDetails).toBe("Record<string, DetailedCommandDescriptor>");

    const describe = commands.describe as { successFields?: Record<string, string> };
    expect(describe.successFields?.command).toContain("canonical command path");
    expect(describe.successFields?.globalFlags).toBe("string[]");
  });
});
