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
const SCHEMA_VERSION_INTENT_PATH = `${CLI_ROOT}/docs/contracts/schema-version-intent.json`;

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
  test("contract schema version follows the checked-in intent gate", () => {
    const versionedDoc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const currentDoc = JSON.parse(readFileSync(CURRENT_CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const intent = JSON.parse(readFileSync(SCHEMA_VERSION_INTENT_PATH, "utf8")) as {
      schemaVersion?: string;
    };

    expect(intent.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(versionedDoc.schemaVersion).toBe(intent.schemaVersion);
    expect(currentDoc.schemaVersion).toBe(intent.schemaVersion);
  });

  test("agent skill contract heading matches the active JSON schema version", () => {
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools/SKILL.md`, "utf8");
    expect(skill).toContain(`## 2. JSON output contract (v${JSON_SCHEMA_VERSION})`);
  });

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
      [String(EXIT_CODES.SETUP)]: "SETUP_REQUIRED",
      [String(EXIT_CODES.ASP)]: "ASP_ERROR",
      [String(EXIT_CODES.RELAYER)]: "RELAYER_ERROR",
      [String(EXIT_CODES.PROOF)]: "PROOF_ERROR",
      [String(EXIT_CODES.CONTRACT)]: "CONTRACT_ERROR",
      [String(EXIT_CODES.CANCELLED)]: "PROMPT_CANCELLED",
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
    expect(init.successFields?.setupMode).toContain("\"create\"");
    expect(init.successFields?.setupMode).toContain("\"restore\"");
    expect(init.successFields?.setupMode).toContain("\"signer_only\"");
    expect(init.successFields?.setupMode).toContain("\"replace\"");
    expect(init.successFields?.readiness).toContain("\"ready\"");
    expect(init.successFields?.readiness).toContain("\"read_only\"");
    expect(init.successFields?.readiness).toContain("\"discovery_required\"");
    expect(init.successFields?.defaultChain).toBe("string");
    expect(init.successFields?.signerKeySet).toBe("boolean");
    expect(init.successFields?.backupFilePath).toContain("string?");
    expect(init.successFields?.recoveryPhraseRedacted).toContain("boolean?");
    expect(init.successFields?.recoveryPhrase).toContain("--show-recovery-phrase");
    expect(init.successFields?.restoreDiscovery).toContain("\"legacy_website_action_required\"");

    const status = commands.status as { successFields?: Record<string, string> };
    expect(status.successFields?.selectedChain).toBe("string|null");
    expect(status.successFields?.recoveryPhraseSet).toBe("boolean");
    expect(status.successFields?.recommendedMode).toContain('"setup-required"');
    expect(status.successFields?.blockingIssues).toContain("StatusIssue[]?");
    expect(status.successFields?.warnings).toContain("StatusIssue[]?");

    const meta = commands.meta as {
      helpEnvelope?: Record<string, string>;
      versionEnvelope?: Record<string, string>;
    };
    expect(meta.helpEnvelope).toEqual({
      mode: "help",
      help: "string",
    });
    expect(meta.versionEnvelope).toEqual({
      mode: "version",
      version: "semver-string",
    });
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
    expect(upgrade.successFields?.externalGuidance).toContain("\"manual_install\"");
  });

  test("doc reflects current flow machine fields", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const flow = commands.flow as { successFields?: Record<string, string> };
    expect(flow.successFields?.action).toContain("\"step\"");
    expect(flow.successFields?.phase).toContain("\"approved_waiting_privacy_delay\"");
    expect(flow.successFields?.workflowKind).toContain("\"deposit_review\"");
    expect(flow.successFields?.walletMode).toBe("\"configured\"|\"new_wallet\"");
    expect(flow.successFields?.walletAddress).toBe("0x-prefixed-address|null");
    expect(flow.successFields?.requiredNativeFunding).toBe("decimal-string-wei|null");
    expect(flow.successFields?.poolAccountId).toBe("string (PA-#)|null");
    expect(flow.successFields?.privacyDelayProfile).toContain("\"balanced\"");
    expect(flow.successFields?.privacyDelayConfigured).toContain("legacy snapshots");
    expect(flow.successFields?.privacyDelayRandom).toContain("boolean");
    expect(flow.successFields?.privacyDelayRangeSeconds).toContain("[number, number]");
    expect(flow.successFields?.privacyDelayUntil).toBe("iso8601-string|null");
    expect(flow.successFields?.nextPollAfter).toBe("iso8601-string|null");
    expect(flow.successFields?.warnings).toContain("FlowWarning[]");
    expect(flow.successFields?.nextActions).toContain("canonical saved-workflow");

    const shared = doc.shared as { flowWarning?: Record<string, string> } | undefined;
    const flowWarningCode = shared?.flowWarning?.code ?? "";
    expect(flowWarningCode).toContain("PRIVACY_NONROUND_AMOUNT");
    expect(flowWarningCode).not.toContain("amount_pattern_linkability");
    expect(shared?.flowWarning?.suggestedRoundAmount).toContain(
      "PRIVACY_NONROUND_AMOUNT",
    );

    const flowDryRun = (flow as { dryRunFields?: Record<string, unknown> }).dryRunFields;
    expect(flowDryRun?.dryRun).toBe(true);
    expect(flowDryRun?.privacyDelayRandom).toBe("boolean");
    expect(flowDryRun?.privacyDelayRangeSeconds).toBe("[number, number]");
  });

  test("doc reflects current activity/accounts/stats machine fields", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const activity = commands.activity as { successFields?: Record<string, string> };
    expect(activity.successFields?.chain).toContain("\"all-mainnets\"");
    expect(activity.successFields?.totalEvents).toContain("number|null");
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
    expect(describe.successFields?.expectedNextActionWhen).toContain("string[]");
    expect(describe.successFields?.agentFlagNames).toContain("string[]");
    expect(describe.successFields?.sideEffectClass).toContain('"fund_movement"');
    expect(describe.successFields?.touchesFunds).toBe("boolean");
    expect(describe.successFields?.requiresHumanReview).toBe("boolean");
    expect(describe.successFields?.preferredSafeVariant).toContain("command: string");
    expect(describe.successFields?.nextActions).toContain(
      "suggests running the described command path",
    );
  });

  test("doc reflects current async transaction and follow-up fields", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const deposit = commands.deposit as { successFields?: Record<string, string> };
    expect(deposit.successFields?.status).toBe("\"submitted\"|\"confirmed\"");
    expect(deposit.successFields?.submissionId).toBe("uuid-string|null");
    expect(deposit.successFields?.workflowId).toContain("uuid-string");
    expect(deposit.successFields?.blockNumber).toBe("decimal-string|null");
    expect(deposit.successFields?.nextActions).toContain("tx-status");

    const withdraw = commands.withdraw as { successFields?: Record<string, string> };
    expect(withdraw.successFields?.status).toBe("\"submitted\"|\"confirmed\"");
    expect(withdraw.successFields?.submissionId).toBe("uuid-string|null");
    expect(withdraw.successFields?.blockNumber).toBe("decimal-string|null");
    expect(withdraw.successFields?.nextActions).toContain("tx-status");

    const ragequit = commands.ragequit as { successFields?: Record<string, string> };
    expect(ragequit.successFields?.status).toBe("\"submitted\"|\"confirmed\"");
    expect(ragequit.successFields?.submissionId).toBe("uuid-string|null");
    expect(ragequit.successFields?.blockNumber).toBe("decimal-string|null");
    expect(ragequit.successFields?.nextActions).toContain("tx-status");

    const broadcast = commands.broadcast as { successFields?: Record<string, string> };
    expect(broadcast.successFields?.mode).toBe("\"broadcast\"");
    expect(broadcast.successFields?.submissionId).toBe("uuid-string|null");
    expect(broadcast.successFields?.transactions).toContain("\"submitted\"|\"confirmed\"|\"validated\"");
    expect(broadcast.successFields?.nextActions).toContain("tx-status");

    const txStatus = commands["tx-status"] as { successFields?: Record<string, string> };
    expect(txStatus.successFields?.operation).toBe("\"tx-status\"");
    expect(txStatus.successFields?.submissionId).toBe("uuid-string");
    expect(txStatus.successFields?.status).toBe("\"submitted\"|\"confirmed\"|\"reverted\"");
    expect(txStatus.successFields?.broadcastSourceOperation).toContain("\"withdraw\"");
    expect(txStatus.successFields?.transactions).toContain("SubmissionTransaction[]");
    expect(txStatus.successFields?.nextActions).toContain("after_submit");
  });

  test("doc reflects current guide/history/migration discovery surfaces", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const capabilities = commands.capabilities as { successFields?: Record<string, string> };
    expect(capabilities.successFields?.nextActions).toContain("describe");

    const config = commands.config as { subcommandVariants?: Record<string, string> };
    expect(config.subcommandVariants?.["config list"]).toContain("defaultChain");

    const completion = commands.completion as { successFields?: Record<string, string> };
    expect(completion.successFields?.mode).toContain("\"completion-install\"");

    const history = commands.history as { successFields?: Record<string, string> };
    expect(history.successFields?.nextActions).toContain("NextAction[]");

    const migrate = commands["migrate status"] as { successFields?: Record<string, string> };
    expect(migrate.successFields?.externalGuidance).toContain("\"website_migration\"");
    expect(migrate.successFields?.nextActions).toContain("NextAction[]");

    const guide = commands.guide as { successFields?: Record<string, string> };
    expect(guide.successFields?.nextActions).toContain("NextAction[]");
  });
});
