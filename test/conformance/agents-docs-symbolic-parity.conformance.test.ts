/**
 * @online
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FLOW_PHASE_VALUES } from "../../src/services/workflow.ts";
import {
  COMMAND_SIDE_EFFECT_CLASS_VALUES,
  NEXT_ACTION_WHEN_VALUES,
} from "../../src/types.ts";
import { COMMAND_PATHS } from "../../src/utils/command-metadata.ts";
import { ERROR_CODE_REGISTRY } from "../../src/utils/error-code-registry.ts";
import { EXIT_CODES } from "../../src/utils/errors.ts";
import {
  extractBacktickedIdentifiers,
  extractPhaseLikeIdentifiers,
  extractSection,
  parseEnumList,
  parseExitCodeLine,
  parseMarkdownTable,
  parseRetryStrategySections,
} from "../helpers/docs-parse.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

// Stateless; safe to run in shared batch.
// Check matrix:
// | Check | AGENTS.md | skills/privacy-pools-cli/SKILL.md | skills/privacy-pools-cli/reference.md |
// | --- | --- | --- | --- |
// | Exit-code parity | X | X | X |
// | Error-code table parity | X |  | X |
// | Retry-strategy parity | X |  | X |
// | Enum parity (`when`, `sideEffectClass`) | X |  |  |
// | Identifier / phase typo scan | X | X | X |
// SKILL.md keeps its unified retry bullets out of structured retryability checks until
// it grows explicit retryable/non-retryable sections. Identifier scanning still covers
// the codes mentioned there.

const AGENTS = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
const SKILL = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
const REFERENCE = readFileSync(
  `${CLI_ROOT}/skills/privacy-pools-cli/reference.md`,
  "utf8",
);

const COMMAND_IDENTIFIER_VALUES = new Set([
  ...COMMAND_PATHS,
  ...COMMAND_PATHS.flatMap((path) => path.split(/\s+/)),
]);

const PROSE_WHITELIST = new Set([
  // General machine-contract prose and type names.
  "CLIError",
  "NextActionWhen",
  "agent",
  "approvalTxHash",
  "args",
  "asp",
  "check",
  "cliCommand",
  "command",
  "commandDetails",
  "csv",
  "default",
  "defaultChain",
  "description",
  "errorCode",
  "errorMessage",
  "executionRoutes",
  "false",
  "help",
  "json",
  "manual",
  "mode",
  "nextAction",
  "nextActions",
  "null",
  "number",
  "operation",
  "options",
  "parameters",
  "quiet",
  "retryable",
  "runnable",
  "safeReadOnlyCommands",
  "schemaVersion",
  "status",
  "stdout",
  "stderr",
  "string",
  "success",
  "table",
  "touchesFunds",
  "true",
  "type",
  "validated",
  "when",
  "yes",
  "CONTRACT",

  // Command/status prose and mode values.
  "approved",
  "arbitrum",
  "aspHost",
  "aspLive",
  "aspStatus",
  "balanced",
  "chain",
  "chainFiltered",
  "chainId",
  "chains",
  "committedValue",
  "declined",
  "direct",
  "ethereum",
  "extraGas",
  "extraGasFundAmount",
  "extraGasTxCost",
  "explorerUrl",
  "flow_change",
  "flow", // captured from prose, distinct from command-path set usage
  "from",
  "installedVersion",
  "label",
  "last24h",
  "latest",
  "mainnet",
  "myFunds",
  "myFundsWarning",
  "native_acceleration_unavailable",
  "note",
  "off",
  "optimism",
  "pending",
  "phase",
  "phase_change",
  "poa_required",
  "pool",
  "privacyCostManifest",
  "privacyDelayRandom",
  "privacyDelayRangeSeconds",
  "protocol",
  "quoteExpiresAt",
  "read_only",
  "readinessResolved",
  "ready",
  "readyForDeposit",
  "readyForUnsigned",
  "readyForWithdraw",
  "recommendedMode",
  "recoveryPhrase",
  "recoveryPhraseRedacted",
  "reference",
  "relayerRequest",
  "restore",
  "rpcBlockNumber",
  "rpcLive",
  "rpcUrl",
  "runtime",
  "scope",
  "sepolia",
  "sideEffectClass",
  "strict",
  "submissionId",
  "submitted",
  "signerKeySet",
  "tokenAddress",
  "total",
  "totalPages",
  "unknown",
  "walletAddress",
  "warning",
  "warnings",
  "withdrawMode",
  "workflowId",
  "workflowKind",

  // Metrics and payload field prose copied through the agent docs.
  "allTime",
  "amount",
  "avgDepositSizeUsd",
  "balance",
  "balances",
  "baseFeeBPS",
  "blockNumber",
  "cacheTimestamp",
  "currentVersion",
  "data",
  "estimatedCommitted",
  "feeAmount",
  "feeBPS",
  "last24h",
  "latestVersion",
  "minimumDeposit",
  "netAmount",
  "nextPollAfter",
  "pendingCount",
  "perChain",
  "poolAccountId",
  "precommitment",
  "previousAvailablePoolAccounts",
  "quoteFeeBPS",
  "recipient",
  "relayTxCost",
  "requiredNativeFunding",
  "requiredTokenFunding",
  "restoreDiscovery",
  "selectedCommitmentLabel",
  "selectedCommitmentValue",
  "syncedSymbols",
  "timestamp",
  "txHash",
  "totalDepositsCount",
  "totalDepositsValue",
  "totalDepositsValueUsd",
  "totalWithdrawalsCount",
  "totalWithdrawalsValue",
  "totalWithdrawalsValueUsd",
  "tvlUsd",
  "updateAvailable",
  "usdValue",
  "value",
  "valueHex",
  "warning",

  // Documented environment variables and operator-facing identifiers.
  "NO_COLOR",
  "PP_ASP_HOST",
  "PP_ASP_HOST_SEPOLIA",
  "PP_NO_UPDATE_CHECK",
  "PP_RELAYER_HOST",
  "PP_RPC_URL",
  "PP_RPC_URL_ARBITRUM",
  "PRIVACY_POOLS_BANNER",
  "PRIVACY_POOLS_BANNER_ART",
  "PRIVACY_POOLS_ASP_HOST",
  "PRIVACY_POOLS_ASP_HOST_SEPOLIA",
  "PRIVACY_POOLS_CIRCUITS_DIR",
  "PRIVACY_POOLS_CLI_BINARY",
  "PRIVACY_POOLS_CLI_DISABLE_NATIVE",
  "PRIVACY_POOLS_CLI_JS_WORKER",
  "PRIVACY_POOLS_CONFIG_DIR",
  "PRIVACY_POOLS_HOME",
  "PRIVACY_POOLS_PRIVATE_KEY",
  "PRIVACY_POOLS_RELAYER_HOST",
  "PRIVACY_POOLS_RPC_URL",
  "PRIVACY_POOLS_RPC_URL_ARBITRUM",
  "merkle",

  // Other machine-contract prose values currently documented verbatim.
  "asset",
  "availablePoolAccounts",
  "balanceSufficient",
  "documentation",
  "npx",
  "performed",
  "phase_change",
  "requiresHumanReview",
  "warning",
]);

function normalizeExitCodeCategory(category: string): string {
  return category.trim().toUpperCase();
}

function parseExitCodeTable(doc: string): Record<string, number> {
  const rows = parseMarkdownTable(extractSection(doc, /^### Exit codes$/m));
  return Object.fromEntries(
    rows.map((row) => [
      normalizeExitCodeCategory(row.category),
      Number(row.code),
    ]),
  );
}

function parseInlineExitCodes(doc: string): Record<string, number> {
  const line = doc.split(/\r?\n/).find((entry) => /^Exit codes:/.test(entry.trim()));
  if (!line) {
    throw new Error("Missing inline exit-code prose.");
  }

  return parseExitCodeLine(line);
}

function formatMap(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatMapDrift(
  label: string,
  documented: Record<string, unknown>,
  code: Record<string, unknown>,
): string {
  const missingFromDocs = Object.keys(code).filter((key) => !(key in documented));
  const extraInDocs = Object.keys(documented).filter((key) => !(key in code));
  const mismatched = Object.keys(documented)
    .filter((key) => key in code && JSON.stringify(documented[key]) !== JSON.stringify(code[key]))
    .map((key) => ({ key, docs: documented[key], code: code[key] }));

  return [
    `${label} drift:`,
    `  Docs has: ${formatMap(documented)}`,
    `  Code has: ${formatMap(code)}`,
    `  Missing from docs: ${missingFromDocs.join(", ") || "(none)"}`,
    `  Extra in docs: ${extraInDocs.join(", ") || "(none)"}`,
    `  Mismatched: ${
      mismatched.length === 0
        ? "(none)"
        : mismatched
            .map((entry) => `${entry.key} (docs=${JSON.stringify(entry.docs)}, code=${JSON.stringify(entry.code)})`)
            .join(", ")
    }`,
  ].join("\n");
}

function parseErrorCodeTable(doc: string, sectionHeader: RegExp) {
  const rows = parseMarkdownTable(extractSection(doc, sectionHeader));
  return Object.fromEntries(
    rows.map((row) => {
      const code = row.errorCode ?? row.code;
      return [
        code,
        {
          category: row.category,
          retryable: row.retryable === "Yes",
        },
      ];
    }),
  );
}

describe("agents docs symbolic parity", () => {
  test("exit-code docs stay aligned with runtime exit categories", () => {
    expect(parseExitCodeTable(AGENTS)).toEqual(EXIT_CODES);
    expect(parseInlineExitCodes(SKILL)).toEqual(EXIT_CODES);
    expect(parseExitCodeTable(REFERENCE)).toEqual(EXIT_CODES);
  });

  test("error-code tables stay aligned with the runtime registry", () => {
    const expected = Object.fromEntries(
      Object.entries(ERROR_CODE_REGISTRY).map(([code, entry]) => [
        code,
        { category: entry.category, retryable: entry.retryable },
      ]),
    );

    const agentsDocumented = parseErrorCodeTable(AGENTS, /^### Error Reference$/m);
    const referenceDocumented = parseErrorCodeTable(REFERENCE, /^### Error codes$/m);

    if (JSON.stringify(agentsDocumented) !== JSON.stringify(expected)) {
      throw new Error(formatMapDrift("AGENTS.md error-code table", agentsDocumented, expected));
    }
    if (JSON.stringify(referenceDocumented) !== JSON.stringify(expected)) {
      throw new Error(
        formatMapDrift("skills/privacy-pools-cli/reference.md error-code table", referenceDocumented, expected),
      );
    }
  });

  test("retry-strategy sections stay aligned with registry retryability", () => {
    for (const [label, doc] of [
      ["AGENTS.md", extractSection(AGENTS, /^### Retry strategy$/m)],
      [
        "skills/privacy-pools-cli/reference.md",
        extractSection(REFERENCE, /^### Retry strategy$/m),
      ],
    ] as const) {
      const { retryableCodes, nonRetryableCodes } = parseRetryStrategySections(doc);

      for (const code of retryableCodes) {
        if (ERROR_CODE_REGISTRY[code]?.retryable !== true) {
          throw new Error(`${label} marked ${code} as retryable, but the registry does not.`);
        }
      }

      for (const code of nonRetryableCodes) {
        if (ERROR_CODE_REGISTRY[code]?.retryable !== false) {
          throw new Error(`${label} marked ${code} as non-retryable, but the registry does not.`);
        }
      }
    }
  });

  test("AGENTS enum lists stay aligned with exported runtime values", () => {
    expect(
      new Set(parseEnumList(AGENTS, /^\*\*`when` discriminator values:\*\*$/m)),
    ).toEqual(new Set(NEXT_ACTION_WHEN_VALUES));

    expect(
      new Set(parseEnumList(AGENTS, /The `sideEffectClass` values are:/m)),
    ).toEqual(new Set(COMMAND_SIDE_EFFECT_CLASS_VALUES));
  });

  test("agent-facing docs only mention known identifiers and flow phases", () => {
    const knownIdentifiers = new Set([
      ...NEXT_ACTION_WHEN_VALUES,
      ...FLOW_PHASE_VALUES,
      ...Object.keys(ERROR_CODE_REGISTRY),
      ...COMMAND_SIDE_EFFECT_CLASS_VALUES,
      ...COMMAND_IDENTIFIER_VALUES,
      ...PROSE_WHITELIST,
    ]);

    const unknown = [
      ...extractBacktickedIdentifiers(AGENTS),
      ...extractBacktickedIdentifiers(SKILL),
      ...extractBacktickedIdentifiers(REFERENCE),
      ...extractPhaseLikeIdentifiers(AGENTS),
      ...extractPhaseLikeIdentifiers(SKILL),
      ...extractPhaseLikeIdentifiers(REFERENCE),
    ].filter((token, index, values) => values.indexOf(token) === index && !knownIdentifiers.has(token));

    expect(unknown).toEqual([]);
  });
});
