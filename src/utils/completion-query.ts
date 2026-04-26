import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_NAMES, CHAINS, KNOWN_POOLS } from "../config/chains.js";
import { POOL_ACCOUNT_STATUSES } from "./statuses.js";
import { FLOW_PRIVACY_DELAY_PROFILES } from "./flow-privacy-delay.js";
import { SUPPORTED_SORT_MODES } from "./pools-sort.js";
import { resolveBaseConfigHome, resolveConfigHome } from "../runtime/config-paths.js";
import { loadAccount } from "../services/account-storage.js";
import { listSavedWorkflowIds } from "../services/workflow.js";
import {
  COMMAND_CATALOG,
  type CommandPath,
} from "./command-catalog.js";
import { rootGlobalFlagValues } from "./root-global-flags.js";
import {
  detectCompletionShell,
  isCompletionShell,
  SUPPORTED_COMPLETION_SHELLS,
  type CompletionShell,
} from "./completion-shell.js";

export const PUBLISHED_BINARY_NAMES = ["privacy-pools"] as const;

export interface CompletionOptionSpec {
  names: string[];
  takesValue: boolean;
  values: string[];
}

export interface CompletionCommandSpec {
  name: string;
  aliases?: string[];
  options?: CompletionOptionSpec[];
  subcommands?: CompletionCommandSpec[];
}

interface CompletionCommandNode {
  name: string;
  options: CompletionOptionSpec[];
  subcommands: Map<string, CompletionCommandNode>;
}

const UNSIGNED_FORMAT_VALUES = ["envelope", "tx"] as const;
const poolAccountCountCache = new Map<string, number>();

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function completionOption(
  flags: string,
  values: readonly string[] = [],
): CompletionOptionSpec {
  const names = flags
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/)[0] ?? "")
    .filter(Boolean);

  return {
    names: uniqueSorted(names),
    takesValue: /<[^>]+>|\[[^\]]+\]/.test(flags),
    values: uniqueSorted([...values]),
  };
}

function completionCommand(
  name: string,
  config: {
    aliases?: string[];
    options?: CompletionOptionSpec[];
    subcommands?: CompletionCommandSpec[];
  } = {},
): CompletionCommandSpec {
  return {
    name,
    aliases: config.aliases ?? [],
    options: config.options ?? [],
    subcommands: config.subcommands ?? [],
  };
}

export const STATIC_COMPLETION_SPEC: CompletionCommandSpec = completionCommand(
  "privacy-pools",
  {
    options: [
      completionOption("-c, --chain <name>", CHAIN_NAMES),
      completionOption("-j, --json"),
      completionOption(
        "-o, --output <format>",
        rootGlobalFlagValues("-o, --output <format>"),
      ),
      completionOption("-y, --yes"),
      completionOption("--web"),
      completionOption("--help-brief"),
      completionOption("--help-full"),
      completionOption("-r, --rpc-url <url>"),
      completionOption("--json-fields <fields>"),
      completionOption("--template <template>"),
      completionOption("--agent"),
      completionOption("-q, --quiet"),
      completionOption("--no-banner"),
      completionOption("-v, --verbose"),
      completionOption("--no-progress"),
      completionOption("--no-header"),
      completionOption("--timeout <seconds>"),
      completionOption("--jmes <expression>"),
      completionOption("--jq <expression>"),
      completionOption("--no-color"),
      completionOption("--profile <name>"),
      completionOption("-V, --version"),
    ],
    subcommands: [
      completionCommand("init", {
        options: [
          completionOption("--recovery-phrase <phrase>"),
          completionOption("--recovery-phrase-file <path>"),
          completionOption("--recovery-phrase-stdin"),
          completionOption("--show-recovery-phrase"),
          completionOption("--backup-file <path>"),
          completionOption("--private-key <key>"),
          completionOption("--private-key-file <path>"),
          completionOption("--private-key-stdin"),
          completionOption("--signer-only"),
          completionOption("--default-chain <chain>", CHAIN_NAMES),
          completionOption("--rpc-url <url>"),
          completionOption("--force"),
          completionOption("--dry-run"),
          completionOption("--staged"),
        ],
      }),
      completionCommand("upgrade", {
        options: [completionOption("--check"), completionOption("--changelog")],
      }),
      completionCommand("config", {
        subcommands: [
          completionCommand("list"),
          completionCommand("get", {
            options: [completionOption("--reveal")],
          }),
          completionCommand("set", {
            options: [
              completionOption("--file <path>"),
              completionOption("--stdin"),
            ],
          }),
          completionCommand("unset", {
            aliases: ["remove"],
          }),
          completionCommand("path"),
          completionCommand("profile", {
            subcommands: [
              completionCommand("list"),
              completionCommand("create"),
              completionCommand("active"),
              completionCommand("use"),
            ],
          }),
        ],
      }),
      completionCommand("flow", {
        subcommands: [
          completionCommand("start", {
            options: [
              completionOption("-t, --to <address>"),
              completionOption("--privacy-delay <profile>", FLOW_PRIVACY_DELAY_PROFILES),
              completionOption("--dry-run"),
              completionOption("--watch"),
              completionOption("--new-wallet"),
              completionOption("--export-new-wallet <path>"),
            ],
          }),
          completionCommand("watch", {
            options: [
              completionOption("--privacy-delay <profile>", FLOW_PRIVACY_DELAY_PROFILES),
              completionOption("--stream-json"),
            ],
          }),
          completionCommand("status"),
          completionCommand("step"),
          completionCommand("ragequit", {
            options: [completionOption("--confirm-ragequit")],
          }),
        ],
      }),
      completionCommand("simulate", {
        subcommands: [
          completionCommand("deposit", {
            options: [
              completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
              completionOption("--dry-run"),
              completionOption("--ignore-unique-amount"),
            ],
          }),
          completionCommand("withdraw", {
            options: [
              completionOption("-t, --to <address>"),
              completionOption("-p, --pool-account <PA-#|#>"),
              completionOption("--direct"),
              completionOption("--confirm-direct-withdraw"),
              completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
              completionOption("--dry-run"),
              completionOption("--all"),
              completionOption("--extra-gas"),
              completionOption("--no-extra-gas"),
            ],
          }),
          completionCommand("ragequit", {
            options: [
              completionOption("-p, --pool-account <PA-#|#>"),
              completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
              completionOption("--dry-run"),
              completionOption("--confirm-ragequit"),
            ],
          }),
        ],
      }),
      completionCommand("pools", {
        options: [
          completionOption("--include-testnets"),
          completionOption("--search <query>"),
          completionOption("--sort <mode>", SUPPORTED_SORT_MODES),
        ],
      }),
      completionCommand("deposit", {
        options: [
          completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
          completionOption("--dry-run"),
          completionOption("--no-wait"),
          completionOption("--ignore-unique-amount"),
        ],
      }),
      completionCommand("accounts", {
        options: [
          completionOption("--no-sync"),
          completionOption("--include-testnets"),
          completionOption("--details"),
          completionOption("--summary"),
          completionOption("--pending-only"),
          completionOption("--status <status>", POOL_ACCOUNT_STATUSES),
          completionOption("--watch"),
        ],
      }),
      completionCommand("migrate", {
        subcommands: [
          completionCommand("status", {
            options: [
              completionOption("--include-testnets"),
            ],
          }),
        ],
      }),
      completionCommand("withdraw", {
        options: [
          completionOption("-t, --to <address>"),
          completionOption("-p, --pool-account <PA-#|#>"),
          completionOption("--direct"),
          completionOption("--confirm-direct-withdraw"),
          completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
          completionOption("--dry-run"),
          completionOption("--no-wait"),
          completionOption("--all"),
          completionOption("--extra-gas"),
          completionOption("--no-extra-gas"),
        ],
        subcommands: [
          completionCommand("quote", {
            options: [
              completionOption("-t, --to <address>"),
            ],
          }),
          completionCommand("recipients", {
            aliases: ["recents"],
            subcommands: [
              completionCommand("list", { aliases: ["ls"] }),
              completionCommand("add", {
                options: [completionOption("--label <label>")],
              }),
              completionCommand("remove", { aliases: ["rm"] }),
              completionCommand("clear"),
            ],
          }),
        ],
      }),
      completionCommand("recipients", {
        aliases: ["recents"],
        subcommands: [
          completionCommand("list", { aliases: ["ls"] }),
          completionCommand("add", {
            options: [completionOption("--label <label>")],
          }),
          completionCommand("remove", { aliases: ["rm"] }),
          completionCommand("clear"),
        ],
      }),
      completionCommand("ragequit", {
        options: [
          completionOption("-p, --pool-account <PA-#|#>"),
          completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
          completionOption("--dry-run"),
          completionOption("--no-wait"),
          completionOption("--confirm-ragequit"),
        ],
      }),
      completionCommand("broadcast", {
        options: [
          completionOption("--no-wait"),
          completionOption("--validate-only"),
        ],
      }),
      completionCommand("history", {
        options: [
          completionOption("--page <n>"),
          completionOption("--no-sync"),
          completionOption("-n, --limit <n>"),
        ],
      }),
      completionCommand("sync", {
        options: [completionOption("--stream-json")],
      }),
      completionCommand("tx-status"),
      completionCommand("status", {
        options: [
          completionOption("--check [scope]"),
          completionOption("--no-check"),
          completionOption("--check-rpc"),
          completionOption("--check-asp"),
        ],
      }),
      completionCommand("activity", {
        options: [
          completionOption("--include-testnets"),
          completionOption("--page <n>"),
          completionOption("-n, --limit <n>"),
        ],
      }),
      completionCommand("protocol-stats"),
      completionCommand("pool-stats"),
      completionCommand("stats", {
        subcommands: [
          completionCommand("global"),
          completionCommand("pool"),
        ],
      }),
      completionCommand("guide", {
        options: [
          completionOption("--topics"),
          completionOption("--pager"),
          completionOption("--no-pager"),
        ],
      }),
      completionCommand("capabilities"),
      completionCommand("describe"),
      completionCommand("completion", {
        options: [
          completionOption("-s, --shell <shell>", SUPPORTED_COMPLETION_SHELLS),
          completionOption("--install"),
        ],
      }),
    ],
  },
);

function buildTreeFromSpec(spec: CompletionCommandSpec): CompletionCommandNode {
  const options = (spec.options ?? []).map((option) => ({
    names: uniqueSorted(option.names),
    takesValue: option.takesValue,
    values: uniqueSorted(option.values),
  }));

  const subcommands = new Map<string, CompletionCommandNode>();

  for (const subcommand of spec.subcommands ?? []) {
    const node = buildTreeFromSpec(subcommand);
    const names = [subcommand.name, ...(subcommand.aliases ?? [])].filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
    for (const name of names) {
      subcommands.set(name, node);
    }
  }

  return {
    name: spec.name,
    options,
    subcommands,
  };
}

const STATIC_COMPLETION_TREE = buildTreeFromSpec(STATIC_COMPLETION_SPEC);

function mergedOptions(
  current: CompletionCommandNode,
  root: CompletionCommandNode,
): CompletionOptionSpec[] {
  const merged = new Map<string, CompletionOptionSpec>();
  const lists =
    current === root ? [current.options] : [root.options, current.options];

  for (const list of lists) {
    for (const option of list) {
      const key = option.names.join("|");
      if (!merged.has(key)) {
        merged.set(key, option);
      }
    }
  }

  return Array.from(merged.values());
}

function findOption(
  token: string,
  current: CompletionCommandNode,
  root: CompletionCommandNode,
): CompletionOptionSpec | undefined {
  if (token === "--json-fields") {
    return {
      names: ["--json-fields"],
      takesValue: true,
      values: [],
    };
  }

  return mergedOptions(current, root).find((option) =>
    option.names.includes(token),
  );
}

function normalizeWords(
  words: string[],
  commandName: string,
  acceptedCommandNames: readonly string[],
): string[] {
  if (words.length === 0) {
    return [commandName];
  }

  if (
    acceptedCommandNames.includes(
      words[0] as (typeof acceptedCommandNames)[number],
    )
  ) {
    return [commandName, ...words.slice(1)];
  }

  return [commandName, ...words];
}

function normalizeCword(cword: number | undefined, wordsLength: number): number {
  if (!Number.isFinite(cword)) {
    return Math.max(wordsLength - 1, 0);
  }

  const normalized = Math.trunc(cword as number);
  return Math.max(0, Math.min(normalized, wordsLength));
}

function looksLikeNegativePositionalToken(token: string): boolean {
  return /^-\d+(?:\.\d+)?$/.test(token);
}

function resolveContext(
  root: CompletionCommandNode,
  words: string[],
  cword: number,
): {
  current: CompletionCommandNode;
  commandPath: string[];
  expectingValueFor?: CompletionOptionSpec;
  consumedOptionNames: Set<string>;
  positionalsBeforeCurrent: string[];
} {
  let current = root;
  const commandPath: string[] = [];
  let expectingValueFor: CompletionOptionSpec | undefined;
  const consumedOptionNames = new Set<string>();
  const positionalsBeforeCurrent: string[] = [];

  const boundary = Math.max(1, Math.min(cword, words.length));

  for (let i = 1; i < boundary; i++) {
    const token = words[i];

    if (expectingValueFor) {
      expectingValueFor = undefined;
      continue;
    }

    if (token.startsWith("-") && !looksLikeNegativePositionalToken(token)) {
      const equalsIndex = token.indexOf("=");
      const flag = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
      const option = findOption(flag, current, root);
      if (option) {
        for (const name of option.names) {
          consumedOptionNames.add(name);
        }
      }
      if (
        option
        && equalsIndex < 0
        && (
          option.takesValue ||
          (isJsonFieldsOption(option) && commandPath.length > 0)
        )
      ) {
        expectingValueFor = option;
      }
      continue;
    }

    const subcommand = current.subcommands.get(token);
    if (subcommand) {
      current = subcommand;
      commandPath.push(token);
      continue;
    }

    positionalsBeforeCurrent.push(token);
  }

  return {
    current,
    commandPath,
    consumedOptionNames,
    expectingValueFor,
    positionalsBeforeCurrent,
  };
}

function filterByPrefix(candidates: string[], prefix: string): string[] {
  if (!prefix) return uniqueSorted(candidates);
  return uniqueSorted(
    candidates.filter((candidate) => candidate.startsWith(prefix)),
  );
}

function isPoolAccountOption(option: CompletionOptionSpec): boolean {
  return option.names.some((n) => n === "--pool-account" || n === "-p");
}

function isProfileOption(option: CompletionOptionSpec): boolean {
  return option.names.some((n) => n === "--profile");
}

function isJsonFieldsOption(option: CompletionOptionSpec): boolean {
  return option.names.some((n) => n === "--json-fields" || n === "--json" || n === "-j");
}

function jsonFieldCandidates(commandPath: string[]): string[] {
  const path = commandPath.join(" ") as CommandPath;
  const jsonFields = COMMAND_CATALOG[path]?.help?.jsonFields;
  const candidates = new Set([
    "schemaVersion",
    "success",
    "errorCode",
    "errorMessage",
    "error",
    "nextActions",
  ]);
  if (jsonFields) {
    for (const rawToken of jsonFields.split(",")) {
      const token = rawToken.trim().replace(/^[{\[]+\s*/, "");
      const match = token.match(/^([A-Za-z][A-Za-z0-9]*)\??(?:\s*:|\s*$|\s+)/);
      const name = match?.[1];
      if (name) candidates.add(name);
    }
  }
  return uniqueSorted([...candidates]);
}

function completeJsonFieldsValue(
  commandPath: string[],
  rawValue: string,
): string[] {
  const parts = rawValue.split(",");
  const current = parts.at(-1)?.trim() ?? "";
  const selected = new Set(
    parts.slice(0, -1).map((part) => part.trim()).filter(Boolean),
  );
  const prefix = parts.length > 1
    ? `${parts.slice(0, -1).map((part) => part.trim()).filter(Boolean).join(",")},`
    : "";
  return filterByPrefix(
    jsonFieldCandidates(commandPath).filter((field) => !selected.has(field)),
    current,
  ).map((field) => `${prefix}${field}`);
}

function configuredDefaultChainName(configHome: string): string | null {
  try {
    const configPath = join(configHome, "config.json");
    if (!existsSync(configPath)) return null;

    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const defaultChain = parsed?.defaultChain;
    return typeof defaultChain === "string" && CHAINS[defaultChain]
      ? defaultChain
      : null;
  } catch {
    return null;
  }
}

function resolveCompletionChainName(words: string[]): string | null {
  try {
    for (let i = 0; i < words.length; i++) {
      const token = words[i];
      if (token === "--chain" || token === "-c") {
        const chainName = words[i + 1];
        if (chainName && CHAINS[chainName]) {
          return chainName;
        }
      } else if (token.startsWith("--chain=")) {
        const chainName = token.slice("--chain=".length);
        if (chainName && CHAINS[chainName]) {
          return chainName;
        }
      }
    }

    return configuredDefaultChainName(resolveConfigHome());
  } catch {
    return null;
  }
}

function dynamicAssetCandidates(words: string[]): string[] {
  const resolvedChain = resolveCompletionChainName(words);
  if (resolvedChain) {
    const chainId = CHAINS[resolvedChain]?.id;
    if (chainId && KNOWN_POOLS[chainId]) {
      return uniqueSorted(Object.keys(KNOWN_POOLS[chainId]));
    }
  }

  return uniqueSorted(
    Object.values(KNOWN_POOLS).flatMap((chainPools) => Object.keys(chainPools)),
  );
}

function currentTokenLooksLikeAssetPosition(
  commandPath: string[],
  positionalsBeforeCurrent: string[],
  consumedOptionNames: ReadonlySet<string>,
): boolean {
  const path = commandPath.join(" ");
  const hasAllFlag = consumedOptionNames.has("--all");

  if (path === "deposit") {
    return positionalsBeforeCurrent.length === 1;
  }

  if (path === "withdraw") {
    return hasAllFlag
      ? positionalsBeforeCurrent.length === 0
      : positionalsBeforeCurrent.length === 1;
  }

  if (path === "withdraw quote") {
    return hasAllFlag
      ? positionalsBeforeCurrent.length === 0
      : positionalsBeforeCurrent.length === 1;
  }

  if (path === "ragequit") {
    return positionalsBeforeCurrent.length === 0;
  }

  return false;
}

/**
 * Read local account state and return PA-1, PA-2, ... candidates.
 * This is a fast, silent, local-only operation -- no network calls.
 */
function dynamicPoolAccountCandidates(words: string[]): string[] {
  try {
    const configHome = resolveConfigHome();
    const accountsDir = join(configHome, "accounts");
    if (!existsSync(accountsDir)) return [];

    // Resolve chain from preceding args or default config.
    let chainId: number | null = null;
    for (let i = 0; i < words.length - 1; i++) {
      const token = words[i];
      if (token === "--chain" || token === "-c") {
        const chainName = words[i + 1];
        const chain = chainName ? CHAINS[chainName] : undefined;
        if (chain) { chainId = chain.id; break; }
      }
    }

    if (chainId === null) {
      // Try default chain from config.
      try {
        const defaultChain = configuredDefaultChainName(configHome);
        if (defaultChain) {
          chainId = CHAINS[defaultChain].id;
        }
      } catch { /* silent */ }
    }

    if (chainId === null) {
      // Scan all account files and merge.
      const files = readdirSync(accountsDir).filter((f) => f.endsWith(".json"));
      const allPaNums = new Set<number>();
      for (const file of files) {
        const cid = Number(file.replace(".json", ""));
        if (!Number.isInteger(cid)) continue;
        const count = countPoolAccounts(configHome, cid);
        for (let i = 1; i <= count; i++) allPaNums.add(i);
      }
      return Array.from(allPaNums).sort((a, b) => a - b).map((n) => `PA-${n}`);
    }

    const count = countPoolAccounts(configHome, chainId);
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => `PA-${i + 1}`);
  } catch {
    return [];
  }
}

function dynamicProfileCandidates(): string[] {
  try {
    const baseConfigHome = resolveBaseConfigHome();
    const profilesDir = join(baseConfigHome, "profiles");
    const profiles = existsSync(profilesDir)
      ? readdirSync(profilesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      : [];
    return uniqueSorted(["default", ...profiles]);
  } catch {
    return ["default"];
  }
}

function dynamicWorkflowCandidates(): string[] {
  try {
    const workflowIds = listSavedWorkflowIds();
    return workflowIds.length > 0
      ? uniqueSorted(["latest", ...workflowIds])
      : [];
  } catch {
    return [];
  }
}

function currentTokenLooksLikeWorkflowIdPosition(
  commandPath: string[],
  positionalsBeforeCurrent: string[],
): boolean {
  const path = commandPath.join(" ");
  return (
    (path === "flow watch" ||
      path === "flow status" ||
      path === "flow ragequit") &&
    positionalsBeforeCurrent.length === 0
  );
}

function currentTokenLooksLikeProfilePosition(
  commandPath: string[],
  positionalsBeforeCurrent: string[],
): boolean {
  return (
    commandPath.join(" ") === "config profile use" &&
    positionalsBeforeCurrent.length === 0
  );
}

function countPoolAccounts(configHome: string, chainId: number): number {
  const cacheKey = `${configHome}:${chainId}`;
  const cached = poolAccountCountCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const account = loadAccount(chainId);
    if (!account) return 0;
    const poolAccounts = account.poolAccounts;
    if (!(poolAccounts instanceof Map)) return 0;
    let total = 0;
    for (const [, value] of poolAccounts) {
      if (Array.isArray(value)) total += value.length;
    }
    poolAccountCountCache.set(cacheKey, total);
    return total;
  } catch {
    return 0;
  }
}

export {
  detectCompletionShell,
  isCompletionShell,
  SUPPORTED_COMPLETION_SHELLS,
  type CompletionShell,
};

export function queryCompletionCandidates(
  wordsInput: string[],
  cwordInput?: number,
  rootSpec: CompletionCommandSpec = STATIC_COMPLETION_SPEC,
): string[] {
  const tree =
    rootSpec === STATIC_COMPLETION_SPEC
      ? STATIC_COMPLETION_TREE
      : buildTreeFromSpec(rootSpec);
  const commandName = tree.name || "privacy-pools";
  const acceptedCommandNames = uniqueSorted([
    commandName,
    ...PUBLISHED_BINARY_NAMES,
  ]);
  const words = normalizeWords(wordsInput, commandName, acceptedCommandNames);
  const cword = normalizeCword(cwordInput, words.length);
  const currentToken = cword < words.length ? words[cword] ?? "" : "";

  const {
    current,
    commandPath,
    consumedOptionNames,
    expectingValueFor,
    positionalsBeforeCurrent,
  } = resolveContext(tree, words, cword);

  if (currentToken.startsWith("-") && currentToken.includes("=")) {
    const equalsIndex = currentToken.indexOf("=");
    const flag = currentToken.slice(0, equalsIndex);
    const valuePrefix = currentToken.slice(equalsIndex + 1);
    const option = findOption(flag, current, tree);
    if (option) {
      if (isJsonFieldsOption(option)) {
        return completeJsonFieldsValue(commandPath, valuePrefix).map(
          (value) => `${flag}=${value}`,
        );
      }
      const values = isPoolAccountOption(option)
        ? dynamicPoolAccountCandidates(words)
        : option.values;
      if (values.length > 0) {
        return filterByPrefix(values, valuePrefix).map(
          (value) => `${flag}=${value}`,
        );
      }
    }
  }

  if (expectingValueFor) {
    if (isPoolAccountOption(expectingValueFor)) {
      const dynamicValues = dynamicPoolAccountCandidates(words);
      if (dynamicValues.length > 0) {
        return filterByPrefix(dynamicValues, currentToken);
      }
    }
    if (isProfileOption(expectingValueFor)) {
      const dynamicValues = dynamicProfileCandidates();
      if (dynamicValues.length > 0) {
        return filterByPrefix(dynamicValues, currentToken);
      }
    }
    if (isJsonFieldsOption(expectingValueFor)) {
      return completeJsonFieldsValue(commandPath, currentToken);
    }
    if (expectingValueFor.values.length === 0) return [];
    return filterByPrefix(expectingValueFor.values, currentToken);
  }

  if (
    !currentToken.startsWith("-")
    && currentToken.indexOf("=") < 0
    && currentTokenLooksLikeAssetPosition(
      commandPath,
      positionalsBeforeCurrent,
      consumedOptionNames,
    )
  ) {
    const dynamicValues = dynamicAssetCandidates(words);
    if (dynamicValues.length > 0) {
      return filterByPrefix(dynamicValues, currentToken);
    }
  }

  if (
    !currentToken.startsWith("-")
    && currentToken.indexOf("=") < 0
    && currentTokenLooksLikeWorkflowIdPosition(
      commandPath,
      positionalsBeforeCurrent,
    )
  ) {
    const dynamicValues = dynamicWorkflowCandidates();
    if (dynamicValues.length > 0) {
      return filterByPrefix(dynamicValues, currentToken);
    }
  }

  if (
    !currentToken.startsWith("-")
    && currentToken.indexOf("=") < 0
    && currentTokenLooksLikeProfilePosition(
      commandPath,
      positionalsBeforeCurrent,
    )
  ) {
    const dynamicValues = dynamicProfileCandidates();
    if (dynamicValues.length > 0) {
      return filterByPrefix(dynamicValues, currentToken);
    }
  }

  const subcommands = Array.from(current.subcommands.keys());
  const options = mergedOptions(current, tree).flatMap((option) => option.names);
  const baseCandidates = [...subcommands, ...options];

  return filterByPrefix(baseCandidates, currentToken);
}
