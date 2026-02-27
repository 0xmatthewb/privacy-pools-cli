import { CHAIN_NAMES } from "../config/chains.js";
export const SUPPORTED_COMPLETION_SHELLS = [
    "bash",
    "zsh",
    "fish",
];
const INTERNAL_COMPLETION_OPTION_NAMES = new Set(["--query", "--cword"]);
function uniqueSorted(values) {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
export function isCompletionShell(value) {
    return SUPPORTED_COMPLETION_SHELLS.includes(value);
}
export function detectCompletionShell(envShell = process.env.SHELL) {
    const raw = (envShell ?? "").toLowerCase();
    if (raw.includes("zsh"))
        return "zsh";
    if (raw.includes("fish"))
        return "fish";
    return "bash";
}
function optionValues(option) {
    const values = new Set();
    if (Array.isArray(option.argChoices)) {
        for (const choice of option.argChoices) {
            values.add(String(choice));
        }
    }
    if (option.long === "--chain" || option.long === "--default-chain") {
        for (const chainName of CHAIN_NAMES) {
            values.add(chainName);
        }
    }
    return Array.from(values);
}
function toOptionSpec(option) {
    // Keep internal completion plumbing flags out of suggestions.
    if (option.long && INTERNAL_COMPLETION_OPTION_NAMES.has(option.long)) {
        return null;
    }
    // Keep advanced/internal flags hidden from completion candidates.
    if (option.hidden) {
        return null;
    }
    const names = [option.short, option.long].filter((name) => typeof name === "string" && name.length > 0);
    if (names.length === 0)
        return null;
    return {
        names: uniqueSorted(names),
        takesValue: option.required || option.optional,
        values: uniqueSorted(optionValues(option)),
    };
}
function buildTree(command) {
    const options = command.options
        .map(toOptionSpec)
        .filter((value) => value !== null);
    const subcommands = new Map();
    for (const subcommand of command.commands) {
        const node = buildTree(subcommand);
        const names = [subcommand.name(), ...subcommand.aliases()].filter((name) => typeof name === "string" && name.length > 0);
        for (const name of names) {
            subcommands.set(name, node);
        }
    }
    return {
        name: command.name(),
        options,
        subcommands,
    };
}
function mergedOptions(current, root) {
    const merged = new Map();
    const lists = current === root ? [current.options] : [root.options, current.options];
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
function findOption(token, current, root) {
    return mergedOptions(current, root).find((option) => option.names.includes(token));
}
function normalizeWords(words, commandName) {
    if (words.length === 0) {
        return [commandName];
    }
    if (words[0] === commandName) {
        return [...words];
    }
    return [commandName, ...words];
}
function normalizeCword(cword, wordsLength) {
    if (!Number.isFinite(cword)) {
        return Math.max(wordsLength - 1, 0);
    }
    const normalized = Math.trunc(cword);
    return Math.max(0, Math.min(normalized, wordsLength));
}
function resolveContext(root, words, cword) {
    let current = root;
    let expectingValueFor;
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
function filterByPrefix(candidates, prefix) {
    if (!prefix)
        return uniqueSorted(candidates);
    return uniqueSorted(candidates.filter((candidate) => candidate.startsWith(prefix)));
}
export function queryCompletionCandidates(rootCommand, wordsInput, cwordInput) {
    const tree = buildTree(rootCommand);
    const words = normalizeWords(wordsInput, tree.name || "privacy-pools");
    const cword = normalizeCword(cwordInput, words.length);
    const currentToken = cword < words.length ? words[cword] ?? "" : "";
    const { current, expectingValueFor } = resolveContext(tree, words, cword);
    if (currentToken.startsWith("-") && currentToken.includes("=")) {
        const equalsIndex = currentToken.indexOf("=");
        const flag = currentToken.slice(0, equalsIndex);
        const valuePrefix = currentToken.slice(equalsIndex + 1);
        const option = findOption(flag, current, tree);
        if (option && option.values.length > 0) {
            return filterByPrefix(option.values, valuePrefix).map((value) => `${flag}=${value}`);
        }
    }
    if (expectingValueFor) {
        if (expectingValueFor.values.length === 0)
            return [];
        return filterByPrefix(expectingValueFor.values, currentToken);
    }
    const subcommands = Array.from(current.subcommands.keys());
    const options = mergedOptions(current, tree).flatMap((option) => option.names);
    const baseCandidates = [...subcommands, ...options];
    return filterByPrefix(baseCandidates, currentToken);
}
function renderBashCompletion(commandName) {
    return `# ${commandName} bash completion
_privacy_pools_completion() {
  local -a words candidates
  local cword line
  words=("\${COMP_WORDS[@]}")
  cword=\${COMP_CWORD}

  while IFS= read -r line; do
    [[ -n "\${line}" ]] && candidates+=("\${line}")
  done < <(command ${commandName} completion --query --shell bash --cword "\${cword}" -- "\${words[@]}" 2>/dev/null)

  COMPREPLY=("\${candidates[@]}")
}

complete -o default -F _privacy_pools_completion ${commandName}
`;
}
function renderZshCompletion(commandName) {
    return `#compdef ${commandName}
_privacy_pools_completion() {
  local -a suggestions tokens
  local cword
  tokens=("\${words[@]}")
  cword=$((CURRENT - 1))
  suggestions=("\${(@f)\$(command ${commandName} completion --query --shell zsh --cword "\${cword}" -- "\${tokens[@]}" 2>/dev/null)}")

  if (( \${#suggestions[@]} > 0 )); then
    compadd -- "\${suggestions[@]}"
  fi
}

compdef _privacy_pools_completion ${commandName}
`;
}
function renderFishCompletion(commandName) {
    return `# ${commandName} fish completion
function __fish_privacy_pools_complete
    set -l tokens (commandline -cx)
    set -l current (commandline -ct)
    set -l cword (math (count $tokens) - 1)

    if test -z "$current"
        set cword (count $tokens)
        set tokens $tokens ""
    end

    command ${commandName} completion --query --shell fish --cword $cword -- $tokens 2>/dev/null
end

complete -c ${commandName} -f -a "(__fish_privacy_pools_complete)"
`;
}
export function renderCompletionScript(shell, commandName = "privacy-pools") {
    if (shell === "bash")
        return renderBashCompletion(commandName);
    if (shell === "zsh")
        return renderZshCompletion(commandName);
    return renderFishCompletion(commandName);
}
