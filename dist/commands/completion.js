import { Command, Option } from "commander";
import { CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { detectCompletionShell, isCompletionShell, queryCompletionCandidates, renderCompletionScript, SUPPORTED_COMPLETION_SHELLS, } from "../utils/completion.js";
function parseShell(shellValue) {
    if (!isCompletionShell(shellValue)) {
        throw new CLIError(`Unsupported shell '${shellValue}'.`, "INPUT", `Supported shells: ${SUPPORTED_COMPLETION_SHELLS.join(", ")}`);
    }
    return shellValue;
}
function parseCword(raw) {
    if (raw === undefined)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new CLIError(`Invalid --cword value '${raw}'.`, "INPUT", "Expected a non-negative integer.");
    }
    return parsed;
}
export function createCompletionCommand() {
    return new Command("completion")
        .description("Generate shell completion script")
        .addOption(new Option("-s, --shell <shell>", "Target shell")
        .choices([...SUPPORTED_COMPLETION_SHELLS]))
        .addOption(new Option("--query", "Internal: query completion candidates").hideHelp())
        .addOption(new Option("--cword <index>", "Internal: current word index").hideHelp())
        .argument("[shell]", "Target shell (bash|zsh|fish)")
        .allowExcessArguments(true)
        .addHelpText("after", [
        "",
        "Examples:",
        "  privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools",
        "  privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools",
        "  privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish",
    ].join("\n"))
        .action((shellArg, opts, cmd) => {
        const root = cmd.parent;
        if (!root) {
            throw new CLIError("Completion command is not attached to root command.", "UNKNOWN");
        }
        const globalOpts = root.opts();
        const mode = resolveGlobalMode(globalOpts);
        const words = cmd.args;
        if (opts.query) {
            const shellName = opts.shell ? parseShell(opts.shell) : detectCompletionShell();
            const cword = parseCword(opts.cword);
            const candidates = queryCompletionCandidates(root, words, cword);
            if (mode.isJson) {
                printJsonSuccess({
                    mode: "completion-query",
                    shell: shellName,
                    cword,
                    candidates,
                });
                return;
            }
            if (candidates.length > 0) {
                process.stdout.write(`${candidates.join("\n")}\n`);
            }
            return;
        }
        if (words.length > 1) {
            throw new CLIError("Too many arguments for completion command.", "INPUT", "Use: privacy-pools completion [shell]");
        }
        if (opts.shell && words.length === 1 && opts.shell !== words[0]) {
            throw new CLIError("Conflicting shell values from --shell and positional argument.", "INPUT", "Specify shell either as positional argument or via --shell, but not both.");
        }
        let shellName;
        if (opts.shell) {
            shellName = parseShell(opts.shell);
        }
        else if (shellArg) {
            shellName = parseShell(shellArg);
        }
        else {
            shellName = detectCompletionShell();
        }
        const script = renderCompletionScript(shellName, root.name() || "privacy-pools");
        if (mode.isJson) {
            printJsonSuccess({
                mode: "completion-script",
                shell: shellName,
                completionScript: script,
            });
            return;
        }
        process.stdout.write(script.endsWith("\n") ? script : `${script}\n`);
    });
}
