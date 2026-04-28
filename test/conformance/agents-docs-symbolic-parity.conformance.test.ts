/**
 * @online
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Command, Option } from "commander";
import { createRootProgram } from "../../src/program.ts";
import { FLOW_PHASE_VALUES } from "../../src/services/workflow.ts";
import {
  COMMAND_SIDE_EFFECT_CLASS_VALUES,
  NEXT_ACTION_WHEN_VALUES,
} from "../../src/types.ts";
import {
  COMMAND_PATHS,
  type CommandPath,
} from "../../src/utils/command-metadata.ts";
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
// | Check | AGENTS.md | skills/privacy-pools/SKILL.md | skills/privacy-pools/references/reference.md |
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
const SKILL = readFileSync(`${CLI_ROOT}/skills/privacy-pools/SKILL.md`, "utf8");
const REFERENCE = readFileSync(
  `${CLI_ROOT}/skills/privacy-pools/references/reference.md`,
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

function extractPrivacyPoolsSnippets(doc: string): string[] {
  const snippets = [
    ...Array.from(doc.matchAll(/`([^`\n]*privacy-pools\s+[^`\n]+)`/g)).map(
      (match) => match[1]!,
    ),
    ...Array.from(doc.matchAll(/^\s*(privacy-pools\s+.+)$/gm)).map(
      (match) => match[1]!,
    ),
  ];
  return [...new Set(snippets)]
    .map((snippet) => snippet.replace(/\s+#.*$/, "").trim())
    .filter((snippet) => snippet.startsWith("privacy-pools "));
}

function tokenizeCommand(snippet: string): string[] {
  return snippet
    .split(/\s+/)
    .map((token) => token.replace(/[),.;:]$/, ""))
    .filter(Boolean);
}

function stripOptionalSyntax(token: string): string {
  return token.replace(/^\[/, "").replace(/\]$/, "");
}

function positionalPlaceholderName(token: string): string | null {
  const normalized = stripOptionalSyntax(token);
  const required = /^<([^>]+)>$/.exec(normalized);
  if (required) return required[1]!.replace(/\.\.\.$/, "");
  const optional = /^\[([^\]]+)\]$/.exec(token);
  if (!optional) return null;
  const name = optional[1]!;
  if (name.startsWith("-")) return null;
  return name.replace(/^<|>$/g, "").replace(/\.\.\.$/, "");
}

function normalizeArgumentName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeOptionToken(token: string, aliases: Map<string, string>): string | null {
  const normalized = stripOptionalSyntax(token).split("=", 1)[0]!;
  if (!normalized.startsWith("-")) return null;
  if (normalized.startsWith("--no-")) return `--${normalized.slice("--no-".length)}`;
  if (normalized.startsWith("--")) return normalized;
  return aliases.get(normalized) ?? normalized;
}

function collectCommandOptions(command: Command): {
  options: Set<string>;
  aliases: Map<string, string>;
  valueOptions: Set<string>;
} {
  const options = new Set<string>();
  const aliases = new Map<string, string>();
  const valueOptions = new Set<string>();
  for (const option of command.options as Option[]) {
    const long = option.long?.replace(/^--no-/, "--");
    if (!long) continue;
    options.add(long);
    if (option.short) aliases.set(option.short, long);
    if (option.required || option.optional) valueOptions.add(long);
  }
  return { options, aliases, valueOptions };
}

function commandPathForSnippet(tokens: readonly string[]): CommandPath | null {
  const nonOptionTokens = tokens
    .slice(1)
    .filter((token) => !stripOptionalSyntax(token).startsWith("-"))
    .filter((token) => positionalPlaceholderName(token) === null);
  for (let length = Math.min(nonOptionTokens.length, 4); length > 0; length -= 1) {
    const candidate = nonOptionTokens.slice(0, length).join(" ");
    if ((COMMAND_PATHS as string[]).includes(candidate)) {
      return candidate as CommandPath;
    }
  }
  return null;
}

function commandPathTokenIndexes(tokens: readonly string[], path: CommandPath): Set<number> {
  const parts = path.split(/\s+/);
  const indexes = new Set<number>();
  let partIndex = 0;

  for (let index = 1; index < tokens.length && partIndex < parts.length; index += 1) {
    const token = stripOptionalSyntax(tokens[index]!);
    if (token.startsWith("-")) continue;
    if (token !== parts[partIndex]) continue;
    indexes.add(index);
    partIndex += 1;
  }

  return indexes;
}

function optionValueIndexes(
  tokens: readonly string[],
  aliases: Map<string, string>,
  valueOptions: Set<string>,
): Set<number> {
  const indexes = new Set<number>();
  for (let index = 1; index < tokens.length; index += 1) {
    const raw = tokens[index]!;
    const option = normalizeOptionToken(raw, aliases);
    if (!option || !valueOptions.has(option) || raw.includes("=")) continue;
    const nextIndex = index + 1;
    if (nextIndex < tokens.length) indexes.add(nextIndex);
  }
  return indexes;
}

function commandByPath(program: Command, path: string): Command | null {
  let current = program;
  for (const part of path.split(/\s+/)) {
    const next = current.commands.find(
      (command) => command.name() === part || command.aliases().includes(part),
    );
    if (!next) return null;
    current = next;
  }
  return current;
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
        formatMapDrift("skills/privacy-pools/references/reference.md error-code table", referenceDocumented, expected),
      );
    }
  });

  test("retry-strategy sections stay aligned with registry retryability", () => {
    for (const [label, doc] of [
      ["AGENTS.md", extractSection(AGENTS, /^### Retry strategy$/m)],
      [
        "skills/privacy-pools/references/reference.md",
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

  test("documented privacy-pools command examples only use real flags", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: true,
      styledHelp: false,
    });
    const rootSurface = collectCommandOptions(program);
    const failures: string[] = [];

    for (const [label, doc] of [
      ["AGENTS.md", AGENTS],
      ["skills/privacy-pools/SKILL.md", SKILL],
      ["skills/privacy-pools/references/reference.md", REFERENCE],
    ] as const) {
      for (const snippet of extractPrivacyPoolsSnippets(doc)) {
        const tokens = tokenizeCommand(snippet);
        const path = commandPathForSnippet(tokens);
        if (!path) continue;
        const command = commandByPath(program, path);
        if (!command) {
          failures.push(`${label}: '${snippet}' references missing command '${path}'`);
          continue;
        }
        const localSurface = collectCommandOptions(command);
        const validOptions = new Set([...rootSurface.options, ...localSurface.options]);
        const aliases = new Map([...rootSurface.aliases, ...localSurface.aliases]);
        const valueOptions = new Set([...rootSurface.valueOptions, ...localSurface.valueOptions]);
        const positionalTokenIndexes = commandPathTokenIndexes(tokens, path);
        const optionValues = optionValueIndexes(tokens, aliases, valueOptions);
        const registeredArguments = command.registeredArguments.map((argument) => argument.name());
        const validArguments = new Set(registeredArguments.map(normalizeArgumentName));

        for (const [index, token] of tokens.entries()) {
          const option = normalizeOptionToken(token, aliases);
          if (option) {
            if (!validOptions.has(option)) {
              failures.push(`${label}: '${snippet}' uses unknown flag '${token}' for '${path}'`);
            }
            continue;
          }
          if (index === 0 || positionalTokenIndexes.has(index) || optionValues.has(index)) continue;
          const placeholder = positionalPlaceholderName(token);
          if (!placeholder) continue;
          if (validArguments.has(normalizeArgumentName(placeholder))) continue;
          failures.push(
            `${label}: '${snippet}' uses positional placeholder '${token}' for '${path}', ` +
              `but registered positionals are [${registeredArguments.join(", ")}]`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
