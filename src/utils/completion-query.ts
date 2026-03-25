import { CHAIN_NAMES } from "../config/chains.js";
import { SUPPORTED_SORT_MODES } from "./pools-sort.js";

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

const OUTPUT_FORMAT_VALUES = ["table", "csv", "json"] as const;
const UNSIGNED_FORMAT_VALUES = ["envelope", "tx"] as const;

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function isCompletionShell(value: string): value is CompletionShell {
  return (SUPPORTED_COMPLETION_SHELLS as readonly string[]).includes(value);
}

export function detectCompletionShell(
  envShell: string | undefined = process.env.SHELL,
): CompletionShell {
  const raw = (envShell ?? "").toLowerCase();
  if (raw.includes("zsh")) return "zsh";
  if (raw.includes("fish")) return "fish";
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
      completionOption("--format <format>", OUTPUT_FORMAT_VALUES),
      completionOption("-y, --yes"),
      completionOption("-r, --rpc-url <url>"),
      completionOption("--agent"),
      completionOption("-q, --quiet"),
      completionOption("--no-banner"),
      completionOption("-v, --verbose"),
      completionOption("--timeout <seconds>"),
      completionOption("--no-color"),
      completionOption("-V, --version"),
    ],
    subcommands: [
      completionCommand("init", {
        options: [
          completionOption("--mnemonic <phrase>"),
          completionOption("--mnemonic-file <path>"),
          completionOption("--mnemonic-stdin"),
          completionOption("--show-mnemonic"),
          completionOption("--private-key <key>"),
          completionOption("--private-key-file <path>"),
          completionOption("--private-key-stdin"),
          completionOption("--default-chain <chain>", CHAIN_NAMES),
          completionOption("--rpc-url <url>"),
          completionOption("--force"),
          completionOption("--skip-circuits"),
        ],
      }),
      completionCommand("flow", {
        subcommands: [
          completionCommand("start", {
            options: [
              completionOption("-t, --to <address>"),
              completionOption("--watch"),
              completionOption("--new-wallet"),
              completionOption("--export-new-wallet <path>"),
            ],
          }),
          completionCommand("watch"),
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
          completionOption("--unsigned-format <format>"),
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
      completionCommand("withdraw", {
        options: [
          completionOption("-t, --to <address>"),
          completionOption("-p, --from-pa <PA-#|#>"),
          completionOption("--direct"),
          completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
          completionOption("--unsigned-format <format>"),
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
          completionOption("-p, --from-pa <PA-#|#>"),
          completionOption("-i, --commitment <index>"),
          completionOption("--unsigned [format]", UNSIGNED_FORMAT_VALUES),
          completionOption("--unsigned-format <format>"),
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
          completionOption("--limit <n>"),
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

function resolveContext(
  root: CompletionCommandNode,
  words: string[],
  cword: number,
): {
  current: CompletionCommandNode;
  expectingValueFor?: CompletionOptionSpec;
} {
  let current = root;
  let expectingValueFor: CompletionOptionSpec | undefined;

  const boundary = Math.max(1, Math.min(cword, words.length));

  for (let i = 1; i < boundary; i++) {
    const token = words[i];

    if (expectingValueFor) {
      expectingValueFor = undefined;
      continue;
    }

    if (token.startsWith("-")) {
      const equalsIndex = token.indexOf("=");
      const flag = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
      const option = findOption(flag, current, root);
      if (option && option.takesValue && equalsIndex < 0) {
        expectingValueFor = option;
      }
      continue;
    }

    const subcommand = current.subcommands.get(token);
    if (subcommand) {
      current = subcommand;
    }
  }

  return { current, expectingValueFor };
}

function filterByPrefix(candidates: string[], prefix: string): string[] {
  if (!prefix) return uniqueSorted(candidates);
  return uniqueSorted(
    candidates.filter((candidate) => candidate.startsWith(prefix)),
  );
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

  const { current, expectingValueFor } = resolveContext(tree, words, cword);

  if (currentToken.startsWith("-") && currentToken.includes("=")) {
    const equalsIndex = currentToken.indexOf("=");
    const flag = currentToken.slice(0, equalsIndex);
    const valuePrefix = currentToken.slice(equalsIndex + 1);
    const option = findOption(flag, current, tree);
    if (option && option.values.length > 0) {
      return filterByPrefix(option.values, valuePrefix).map(
        (value) => `${flag}=${value}`,
      );
    }
  }

  if (expectingValueFor) {
    if (expectingValueFor.values.length === 0) return [];
    return filterByPrefix(expectingValueFor.values, currentToken);
  }

  const subcommands = Array.from(current.subcommands.keys());
  const options = mergedOptions(current, tree).flatMap((option) => option.names);
  const baseCandidates = [...subcommands, ...options];

  return filterByPrefix(baseCandidates, currentToken);
}
