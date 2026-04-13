import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CHAIN_NAMES, CHAINS, KNOWN_POOLS } from "../config/chains.js";
import { FLOW_PRIVACY_DELAY_PROFILES } from "./flow-privacy-delay.js";
import { SUPPORTED_SORT_MODES } from "./pools-sort.js";
import { resolveConfigHome } from "../runtime/config-paths.js";
import { loadAccount } from "../services/account-storage.js";

export const SUPPORTED_COMPLETION_SHELLS = [
  "bash",
  "zsh",
  "fish",
  "powershell",
] as const;

export type CompletionShell = (typeof SUPPORTED_COMPLETION_SHELLS)[number];

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

const OUTPUT_FORMAT_VALUES = ["table", "csv", "json", "wide"] as const;
const UNSIGNED_FORMAT_VALUES = ["envelope", "tx"] as const;

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function isCompletionShell(value: string): value is CompletionShell {
  return (SUPPORTED_COMPLETION_SHELLS as readonly string[]).includes(value);
}

export function detectCompletionShell(
  envShell: string | undefined = process.env.SHELL,
  platform: NodeJS.Platform = process.platform,
): CompletionShell {
  const raw = (envShell ?? "").toLowerCase();
  if (raw.includes("zsh")) return "zsh";
  if (raw.includes("fish")) return "fish";
  if (raw.includes("pwsh") || raw.includes("powershell")) return "powershell";
  if (raw.includes("bash")) return "bash";
  if (platform === "win32") return "powershell";
  return "bash";
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
      completionOption("--json-fields <fields>"),
      completionOption("--format <format>", OUTPUT_FORMAT_VALUES),
      completionOption("-y, --yes"),
      completionOption("-r, --rpc-url <url>"),
      completionOption("--agent"),
      completionOption("-q, --quiet"),
      completionOption("--no-banner"),
      completionOption("-v, --verbose"),
      completionOption("--no-progress"),
      completionOption("--no-header"),
      completionOption("--timeout <seconds>"),
      completionOption("--jq <expression>"),
      completionOption("--no-color"),
      completionOption("--profile <name>"),
      completionOption("-V, --version"),
    ],
    subcommands: [
      completionCommand("init", {
        options: [
          completionOption("--mnemonic <phrase>"),
          completionOption("--mnemonic-file <path>"),
          completionOption("--mnemonic-stdin"),
          completionOption("--show-mnemonic"),
          completionOption("--recovery-phrase <phrase>"),
          completionOption("--recovery-phrase-file <path>"),
          completionOption("--recovery-phrase-stdin"),
          completionOption("--show-recovery-phrase"),
          completionOption("--private-key <key>"),
          completionOption("--private-key-file <path>"),
          completionOption("--private-key-stdin"),
          completionOption("--default-chain <chain>", CHAIN_NAMES),
          completionOption("--rpc-url <url>"),
          completionOption("--force"),
          completionOption("--skip-circuits"),
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
          completionCommand("path"),
          completionCommand("profile", {
            subcommands: [
              completionCommand("list"),
              completionCommand("create"),
              completionCommand("active"),
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
              completionOption("--watch"),
              completionOption("--new-wallet"),
              completionOption("--export-new-wallet <path>"),
            ],
          }),
          completionCommand("watch", {
            options: [
              completionOption("--privacy-delay <profile>", FLOW_PRIVACY_DELAY_PROFILES),
            ],
          }),
          completionCommand("status"),
          completionCommand("ragequit"),
        ],
      }),
      completionCommand("pools", {
        options: [
          completionOption("--all-chains"),
          completionOption("--search <query>"),
          completionOption("--sort <mode>", SUPPORTED_SORT_MODES),
        ],
      }),
      completionCommand("deposit", {
        options: [
          completionOption("-a, --asset <symbol|address>"),
          completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
          completionOption("--dry-run"),
          completionOption("--ignore-unique-amount"),
        ],
      }),
      completionCommand("accounts", {
        options: [
          completionOption("--no-sync"),
          completionOption("--all-chains"),
          completionOption("--details"),
          completionOption("--summary"),
          completionOption("--pending-only"),
        ],
      }),
      completionCommand("migrate", {
        subcommands: [
          completionCommand("status", {
            options: [
              completionOption("--all-chains"),
            ],
          }),
        ],
      }),
      completionCommand("withdraw", {
        options: [
          completionOption("-t, --to <address>"),
          completionOption("-p, --pool-account <PA-#|#>"),
          completionOption("--from-pa <PA-#|#>"),
          completionOption("--direct"),
          completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
          completionOption("--dry-run"),
          completionOption("-a, --asset <symbol|address>"),
          completionOption("--all"),
          completionOption("--extra-gas"),
          completionOption("--no-extra-gas"),
        ],
        subcommands: [
          completionCommand("quote", {
            options: [
              completionOption("-a, --asset <symbol|address>"),
              completionOption("-t, --to <address>"),
            ],
          }),
        ],
      }),
      completionCommand("ragequit", {
        aliases: ["exit"],
        options: [
          completionOption("-a, --asset <symbol|address>"),
          completionOption("-p, --pool-account <PA-#|#>"),
          completionOption("--from-pa <PA-#|#>"),
          completionOption("-i, --commitment <index>"),
          completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
          completionOption("--dry-run"),
        ],
      }),
      completionCommand("history", {
        options: [
          completionOption("--no-sync"),
          completionOption("-n, --limit <n>"),
        ],
      }),
      completionCommand("sync", {
        options: [completionOption("-a, --asset <symbol|address>")],
      }),
      completionCommand("status", {
        options: [
          completionOption("--check"),
          completionOption("--no-check"),
          completionOption("--check-rpc"),
          completionOption("--check-asp"),
        ],
      }),
      completionCommand("activity", {
        options: [
          completionOption("-a, --asset <symbol|address>"),
          completionOption("--page <n>"),
          completionOption("-n, --limit <n>"),
        ],
      }),
      completionCommand("stats", {
        subcommands: [
          completionCommand("global"),
          completionCommand("pool", {
            options: [completionOption("-a, --asset <symbol|address>")],
          }),
        ],
      }),
      completionCommand("guide"),
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
      if (option && option.takesValue && equalsIndex < 0) {
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

function isAssetOption(option: CompletionOptionSpec): boolean {
  return option.names.some((n) => n === "--asset" || n === "-a");
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
        const count = countPoolAccounts(cid);
        for (let i = 1; i <= count; i++) allPaNums.add(i);
      }
      return Array.from(allPaNums).sort((a, b) => a - b).map((n) => `PA-${n}`);
    }

    const count = countPoolAccounts(chainId);
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => `PA-${i + 1}`);
  } catch {
    return [];
  }
}

function countPoolAccounts(chainId: number): number {
  try {
    const account = loadAccount(chainId);
    if (!account) return 0;
    const poolAccounts = account.poolAccounts;
    if (!(poolAccounts instanceof Map)) return 0;
    let total = 0;
    for (const [, value] of poolAccounts) {
      if (Array.isArray(value)) total += value.length;
    }
    return total;
  } catch {
    return 0;
  }
}

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
      const values = isPoolAccountOption(option)
        ? dynamicPoolAccountCandidates(words)
        : isAssetOption(option)
          ? dynamicAssetCandidates(words)
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
    if (isAssetOption(expectingValueFor)) {
      const dynamicValues = dynamicAssetCandidates(words);
      if (dynamicValues.length > 0) {
        return filterByPrefix(dynamicValues, currentToken);
      }
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

  const subcommands = Array.from(current.subcommands.keys());
  const options = mergedOptions(current, tree).flatMap((option) => option.names);
  const baseCandidates = [...subcommands, ...options];

  return filterByPrefix(baseCandidates, currentToken);
}
