import chalk from "chalk";
const SECTION_HEADERS = new Set(["Options:", "Commands:", "Arguments:"]);
export function styleCommanderHelp(raw) {
    if (!raw.includes("Usage:"))
        return raw;
    const lines = raw.split("\n");
    let section = null;
    const styled = lines.map((line) => {
        const trimmed = line.trim();
        if (line.startsWith("Usage:")) {
            const usage = line.slice("Usage:".length).trim();
            section = null;
            return `${chalk.bold.cyan("Usage:")} ${chalk.bold(usage)}`;
        }
        if (SECTION_HEADERS.has(trimmed)) {
            section = trimmed.replace(":", "").toLowerCase();
            return chalk.bold.cyan(trimmed);
        }
        if (trimmed === "") {
            return line;
        }
        if (section === "options") {
            const m = line.match(/^(\s{2,})(-[^-].*?|--[a-zA-Z0-9][^ ]*(?: [^ ]+)?.*?)(\s{2,})(.+)$/);
            if (m) {
                return `${m[1]}${chalk.yellow(m[2])}${m[3]}${m[4]}`;
            }
            return line;
        }
        if (section === "commands") {
            const m = line.match(/^(\s{2,})([a-z][\w-]*(?:\s+\[[^\]]+\])?(?:\s+<[^>]+>)?)(\s{2,})(.+)$/i);
            if (m) {
                return `${m[1]}${chalk.green(m[2])}${m[3]}${m[4]}`;
            }
            return line;
        }
        if (section === "arguments") {
            const m = line.match(/^(\s{2,})([a-zA-Z][\w-]*)(\s{2,})(.+)$/);
            if (m) {
                return `${m[1]}${chalk.magenta(m[2])}${m[3]}${m[4]}`;
            }
            return line;
        }
        return line;
    });
    return styled.join("\n");
}
/**
 * Minimal footer for root --help. Points users to the right places
 * without overwhelming them with a tutorial.
 */
export function rootHelpFooter() {
    return [
        "",
        `  Human mode:       ${chalk.cyan("privacy-pools init")}`,
        `  Short alias:      ${chalk.cyan("pp init")}`,
        `  Agent mode:       ${chalk.cyan("privacy-pools -j -y status")}`,
        `  Agent unsigned:   ${chalk.cyan("privacy-pools -j -y deposit ETH 0.1 --unsigned --chain sepolia")}`,
        `  Full guide:       ${chalk.cyan("privacy-pools guide")}`,
        `  Command help:     ${chalk.cyan("privacy-pools <command> --help")}`,
        `  Advanced flags:   ${chalk.cyan("See 'privacy-pools guide' for full global options and env vars")}`,
    ].join("\n");
}
/**
 * Full guide content - displayed by `privacy-pools guide`.
 * Contains the quick start, workflow, automation tips, and exit codes
 * that used to live in root --help.
 */
export function guideText() {
    return [
        chalk.bold.cyan("Privacy Pools CLI - Quick Guide"),
        "",
        chalk.bold("Install & Run"),
        `  ${chalk.cyan("npm i -g github:0xmatthewb/privacy-pools-cli")}`,
        `  ${chalk.cyan("bun add -g github:0xmatthewb/privacy-pools-cli")}`,
        `  ${chalk.cyan("pp status")}                                  ${chalk.dim("(short alias for privacy-pools)")}`,
        `  ${chalk.cyan("bun run dev -- status")}                        ${chalk.dim("(from source, no global install)")}`,
        `  ${chalk.cyan("privacy-pools completion zsh")}                   ${chalk.dim("(shell autocomplete)")}`,
        "",
        chalk.bold("Quick Start"),
        `  ${chalk.cyan("privacy-pools init")}`,
        `  ${chalk.cyan("privacy-pools pools --chain sepolia")}`,
        `  ${chalk.cyan("privacy-pools deposit 0.1 --asset ETH --chain sepolia")}`,
        `  ${chalk.cyan("privacy-pools accounts --chain sepolia")}              ${chalk.dim("(wait for Approved status)")}`,
        `  ${chalk.cyan("privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient -p PA-1 --chain sepolia")}`,
        "",
        chalk.dim("  Deposits are reviewed by the ASP (Association Set Provider) before approval."),
        chalk.dim("  Most deposits are approved within 1 hour; some may take up to 7 days."),
        "",
        chalk.bold("Workflow"),
        `  1. ${chalk.green("init")}           Set up wallet and config (run once)`,
        `  2. ${chalk.green("pools")}          Browse available pools`,
        `  3. ${chalk.green("deposit")}        Deposit into a pool`,
        `  4. ${chalk.green("accounts")}       Check Pool Account (PA) approval status`,
        `  5. ${chalk.green("withdraw")}       Withdraw from a pool (once approved)`,
        `  6. ${chalk.green("balance")}        Check balances`,
        `  7. ${chalk.green("history")}        View transaction history`,
        `  *  ${chalk.green("sync")}           Re-sync onchain state (most commands sync automatically)`,
        `  *  ${chalk.green("status")}         Check setup anytime`,
        `  *  ${chalk.green("ragequit")}       Public exit — returns funds to deposit address (alias: exit)`,
        `  *  ${chalk.green("withdraw quote")} Check relayer fees before withdrawing`,
        "",
        chalk.bold("Global Options"),
        `  ${chalk.yellow("-c, --chain <name>")}    Target chain (ethereum, arbitrum, optimism, sepolia, op-sepolia)`,
        `  ${chalk.yellow("-r, --rpc-url <url>")}   Override RPC URL`,
        `  ${chalk.yellow("-j, --json")}            Machine-readable JSON output`,
        `  ${chalk.yellow("-y, --yes")}             Skip confirmation prompts`,
        `  ${chalk.yellow("-q, --quiet")}           Suppress spinners and non-essential output`,
        `  ${chalk.yellow("-v, --verbose")}         Enable verbose/debug output`,
        `  ${chalk.yellow("--no-banner")}            Disable ASCII banner`,
        "",
        chalk.bold("Environment Variables"),
        `  ${chalk.yellow("PRIVACY_POOLS_PRIVATE_KEY")}   Signer key (alternative to --private-key in init)`,
        `  ${chalk.yellow("PRIVACY_POOLS_HOME")}          Config directory override (default: ~/.privacy-pools)`,
        `  ${chalk.yellow("PP_RPC_URL_<CHAIN>")}           Override RPC endpoint per chain (e.g. PP_RPC_URL_ARBITRUM)`,
        `  ${chalk.yellow("PP_ASP_HOST_<CHAIN>")}          Override ASP endpoint per chain (e.g. PP_ASP_HOST_SEPOLIA)`,
        `  ${chalk.yellow("PP_RELAYER_HOST_<CHAIN>")}      Override relayer endpoint per chain`,
        "",
        chalk.bold("Interaction Modes"),
        "  Human mode (default): interactive prompts + readable output.",
        "  Agent mode: -j -y for structured JSON output, no prompts.",
        "  Shorthand: --agent is equivalent to -j -y -q.",
        "  --unsigned builds transaction payloads without submitting.",
        "  --dry-run validates and generates proofs without submitting.",
        "",
        chalk.bold("Troubleshooting"),
        "  Stale data?     Run 'privacy-pools sync' to re-sync from onchain events.",
        "  ASP unreachable? Check 'privacy-pools status --check-asp' and retry later.",
        "  Long proof time? First proof downloads circuits (~60s). Subsequent proofs are faster.",
        "  Custom RPC?     Pass --rpc-url on any command, or save per-chain overrides in",
        `                  ~/.privacy-pools/config.json under ${chalk.dim('"rpcOverrides": { "<chainId>": "https://..." }')}.`,
        "",
        chalk.bold("Exit Codes"),
        `  ${chalk.green("0")}  Success`,
        `  ${chalk.red("1")}  Unknown/general error`,
        `  ${chalk.red("2")}  Input/validation error`,
        `  ${chalk.red("3")}  RPC/network error`,
        `  ${chalk.red("4")}  ASP (Association Set Provider) error`,
        `  ${chalk.red("5")}  Relayer error`,
        `  ${chalk.red("6")}  Proof generation error`,
        `  ${chalk.red("7")}  Contract revert`,
        "",
        chalk.dim("  Run privacy-pools <command> --help for command-specific details."),
    ].join("\n");
}
export function commandHelpText(config) {
    const lines = [];
    if (config.prerequisites) {
        lines.push("", "Prerequisites:");
        lines.push(`  Requires: ${config.prerequisites}`);
    }
    if (config.jsonFields) {
        lines.push("", "JSON output (--json):");
        lines.push(`  ${config.jsonFields}`);
    }
    return lines.join("\n");
}
