import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  JSON_SCHEMA_VERSION,
  jsonContractDocRelativePath,
} from "../../src/utils/json.ts";
import { EXIT_CODES } from "../../src/utils/errors.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

const CONTRACT_DOC_PATH = `${CLI_ROOT}/${jsonContractDocRelativePath()}`;
const CURRENT_CONTRACT_DOC_PATH = `${CLI_ROOT}/docs/contracts/cli-json-contract.current.json`;

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
    expect(doc.version).toBe(JSON_SCHEMA_VERSION);
    expect(doc.schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });

  test("stable current contract path matches the runtime versioned snapshot", () => {
    const versionedDoc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const currentDoc = JSON.parse(readFileSync(CURRENT_CONTRACT_DOC_PATH, "utf8")) as ContractDoc;

    expect(currentDoc).toEqual(versionedDoc);
    expect(currentDoc.version).toBe(JSON_SCHEMA_VERSION);
    expect(currentDoc.schemaVersion).toBe(JSON_SCHEMA_VERSION);
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
    expect(init.successFields?.recoveryPhrase).toContain("--show-recovery-phrase");

    const status = commands.status as { successFields?: Record<string, string> };
    expect(status.successFields?.selectedChain).toBe("string|null");
    expect(status.successFields?.recoveryPhraseSet).toBe("boolean");
    expect(status.successFields?.recommendedMode).toContain('"setup-required"');
    expect(status.successFields?.blockingIssues).toContain("StatusIssue[]?");
    expect(status.successFields?.warnings).toContain("StatusIssue[]?");

    const meta = commands.meta as Record<string, unknown>;
    expect(meta.helpEnvelope).toBeTruthy();
    expect(meta.versionEnvelope).toBeTruthy();
  });

  test("doc reflects current upgrade machine fields", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const upgrade = commands.upgrade as { successFields?: Record<string, string> };
    expect(upgrade.successFields?.mode).toBe("\"upgrade\"");
    expect(upgrade.successFields?.status).toContain("\"upgraded\"");
    expect(upgrade.successFields?.command).toBe("string|null");
    expect(upgrade.successFields?.installContext).toContain("\"bun_global\"");
    expect(upgrade.successFields?.installedVersion).toBe("string|null");
  });

  test("doc reflects current flow machine fields", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const flow = commands.flow as { successFields?: Record<string, string> };
    expect(flow.successFields?.phase).toContain("\"approved_waiting_privacy_delay\"");
    expect(flow.successFields?.walletMode).toBe("\"configured\"|\"new_wallet\"");
    expect(flow.successFields?.walletAddress).toBe("0x-prefixed-address|null");
    expect(flow.successFields?.requiredNativeFunding).toBe("decimal-string-wei|null");
    expect(flow.successFields?.poolAccountId).toBe("string (PA-#)|null");
    expect(flow.successFields?.privacyDelayProfile).toContain("\"balanced\"");
    expect(flow.successFields?.privacyDelayConfigured).toContain("legacy snapshots");
    expect(flow.successFields?.privacyDelayUntil).toBe("iso8601-string|null");
    expect(flow.successFields?.warnings).toContain("FlowWarning[]");
    expect(flow.successFields?.nextActions).toContain("canonical saved-workflow");
  });

  test("doc reflects current activity/accounts/stats machine fields", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const activity = commands.activity as { successFields?: Record<string, string> };
    expect(activity.successFields?.chain).toContain("\"all-mainnets\"");
    expect(activity.successFields?.chainFiltered).toContain("boolean?");
    expect(activity.successFields?.note).toContain("string?");

    const accounts = commands.accounts as { accountFields?: Record<string, string> };
    expect(accounts.accountFields?.aspStatus).toContain("\"poa_required\"");
    expect(accounts.accountFields?.aspStatus).toContain("\"declined\"");
    expect(accounts.accountFields?.aspStatus).toContain("\"unknown\"");
    expect((accounts as { summaryVariant?: Record<string, string> }).summaryVariant?.poaRequiredCount).toBe("number");
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
    expect(capabilities.successFields?.executionRoutes).toBe(
      "Record<string, { owner, nativeModes }>",
    );
    expect(capabilities.successFields?.protocol).toBe("ProtocolProfile");
    expect(capabilities.successFields?.runtime).toBe("RuntimeCompatibilityDescriptor");

    const describe = commands.describe as { successFields?: Record<string, string> };
    expect(describe.successFields?.command).toContain("canonical command path");
    expect(describe.successFields?.globalFlags).toBe("string[]");
    expect(describe.successFields?.execution).toContain('"js-runtime"|"native-shell"|"hybrid"');
    expect(describe.successFields?.sideEffectClass).toContain('"fund_movement"');
    expect(describe.successFields?.touchesFunds).toBe("boolean");
    expect(describe.successFields?.requiresHumanReview).toBe("boolean");
    expect(describe.successFields?.preferredSafeVariant).toContain("command: string");
  });
});
