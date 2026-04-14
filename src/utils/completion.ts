import type { Command, Option } from "commander";
import { CHAIN_NAMES } from "../config/chains.js";
import {
  PUBLISHED_BINARY_NAMES,
  type CompletionCommandSpec,
  type CompletionOptionSpec,
  type CompletionShell,
} from "./completion-query.js";

export {
  detectCompletionShell,
  isCompletionShell,
  PUBLISHED_BINARY_NAMES,
  queryCompletionCandidates,
  STATIC_COMPLETION_SPEC,
  SUPPORTED_COMPLETION_SHELLS,
  type CompletionCommandSpec,
  type CompletionOptionSpec,
  type CompletionShell,
} from "./completion-query.js";

const INTERNAL_COMPLETION_OPTION_NAMES = new Set([
  "--query",
  "--cword",
  "--from-pa",
]);

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function optionValues(option: Option): string[] {
  const values = new Set<string>();

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

function toOptionSpec(option: Option): CompletionOptionSpec | null {
  if (option.long && INTERNAL_COMPLETION_OPTION_NAMES.has(option.long)) {
    return null;
  }

  const names = [option.short, option.long].filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );

  if (names.length === 0) return null;

  return {
    names: uniqueSorted(names),
    takesValue: option.required || option.optional,
    values: uniqueSorted(optionValues(option)),
  };
}

export function buildCompletionSpecFromCommand(
  command: Command,
): CompletionCommandSpec {
  const options = command.options
    .map(toOptionSpec)
    .filter((value): value is CompletionOptionSpec => value !== null);
  const subcommands = command.commands.map((subcommand) =>
    buildCompletionSpecFromCommand(subcommand),
  );

  return {
    name: command.name(),
    aliases: command.aliases(),
    options,
    subcommands,
  };
}

function renderBashCompletion(commandNames: string[]): string {
  const registrations = commandNames
    .map(
      (commandName) =>
        `complete -o default -F _privacy_pools_completion ${commandName}`,
    )
    .join("\n");

  return `# ${commandNames.join(", ")} bash completion
_privacy_pools_completion() {
  local -a words candidates
  local cword line command_name
  words=("\${COMP_WORDS[@]}")
  cword=\${COMP_CWORD}
  command_name="\${COMP_WORDS[0]:-privacy-pools}"

  while IFS= read -r line; do
    [[ -n "\${line}" ]] && candidates+=("\${line}")
  done < <(command "\${command_name}" completion --query --shell bash --cword "\${cword}" -- "\${words[@]}" 2>/dev/null)

  COMPREPLY=("\${candidates[@]}")
}

${registrations}
`;
}

function renderZshCompletion(commandNames: string[]): string {
  const zshNames = commandNames.join(" ");
  return `#compdef ${zshNames}
_privacy_pools_completion() {
  local -a suggestions tokens
  local cword command_name
  tokens=("\${words[@]}")
  cword=$((CURRENT - 1))
  command_name="\${words[1]:-privacy-pools}"
  suggestions=("\${(@f)\$(command "\${command_name}" completion --query --shell zsh --cword "\${cword}" -- "\${tokens[@]}" 2>/dev/null)}")

  if (( \${#suggestions[@]} > 0 )); then
    compadd -- "\${suggestions[@]}"
  fi
}

compdef _privacy_pools_completion ${zshNames}
`;
}

function renderFishCompletion(commandNames: string[]): string {
  const registrations = commandNames
    .map(
      (commandName) =>
        `complete -c ${commandName} -f -a "(__fish_privacy_pools_complete)"`,
    )
    .join("\n");

  return `# ${commandNames.join(", ")} fish completion
function __fish_privacy_pools_complete
    set -l tokens (commandline -cx)
    set -l current (commandline -ct)
    set -l cword (math (count $tokens) - 1)
    set -l command_name privacy-pools

    if test -z "$current"
        set cword (count $tokens)
        set tokens $tokens ""
    end

    if test (count $tokens) -gt 0
        set command_name $tokens[1]
    end

    command $command_name completion --query --shell fish --cword $cword -- $tokens 2>/dev/null
end

${registrations}
`;
}

function renderPowerShellCompletion(commandNames: string[]): string {
  const registrations = commandNames
    .map(
      (commandName) => `Register-ArgumentCompleter -CommandName ${commandName} -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $words = $commandAst.ToString() -split '\\s+'
    $cword = $words.Count - 1
    if ($wordToComplete -eq '') { $cword = $words.Count; $words += '' }
    $candidates = & ${commandName} completion --query --shell powershell --cword $cword -- @words 2>$null
    if ($candidates) {
        $candidates -split '\\n' | Where-Object { $_ -ne '' } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
    }
}`,
    )
    .join("\n\n");

  return `# ${commandNames.join(", ")} PowerShell completion
${registrations}
`;
}

export function renderCompletionScript(
  shell: CompletionShell,
  commandNames: string[] = [...PUBLISHED_BINARY_NAMES],
): string {
  if (shell === "bash") return renderBashCompletion(commandNames);
  if (shell === "zsh") return renderZshCompletion(commandNames);
  if (shell === "powershell") return renderPowerShellCompletion(commandNames);
  return renderFishCompletion(commandNames);
}
