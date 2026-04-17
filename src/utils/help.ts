import chalk from "chalk";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "./approval-timing.js";
import { OUTPUT_FORMAT_DESCRIPTION } from "./mode.js";
import { accent, accentBold, brand, dangerTone, notice, successTone } from "./theme.js";
import { inlineSeparator } from "./terminal.js";
import {
  DEFAULT_WELCOME_SCREEN_ACTIONS,
  type WelcomeAction,
} from "./welcome-readiness.js";
export { styleCommanderHelp } from "./root-help.js";

function defaultPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function shouldShowPathRegistrationHint(
  packageRoot: string = defaultPackageRoot(),
): boolean {
  return Boolean(process.env.npm_lifecycle_event) && existsSync(join(packageRoot, ".git"));
}

function formatWelcomeActionLines(actions: readonly WelcomeAction[]): string[] {
  const renderedCommands = actions.map(
    (action) => `privacy-pools ${action.cliCommand}`,
  );
  const commandWidth =
    Math.max(...renderedCommands.map((command) => command.length), 0) + 1;

  return actions.map((action, index) =>
    `${accent(renderedCommands[index].padEnd(commandWidth))}${chalk.dim(action.description)}`,
  );
}

/**
 * Condensed welcome screen shown on bare `privacy-pools` (no args).
 * Orients the user quickly without the full Commander listing.
 */
export function welcomeScreen(
  options: {
    packageRoot?: string;
    version?: string;
    readinessLabel?: string;
    actions?: readonly WelcomeAction[];
  } = {},
): string {
  const version = options.version?.trim();
  const sep = inlineSeparator();
  const versionLine = version
    ? `${chalk.dim(`v${version}`)}${chalk.dim(sep)}${accent("privacypools.com")}${options.readinessLabel ? `${chalk.dim(sep)}${chalk.dim(options.readinessLabel)}` : ""}`
    : accent("privacypools.com");
  const actionLines = formatWelcomeActionLines(
    options.actions ?? DEFAULT_WELCOME_SCREEN_ACTIONS,
  );

  const lines = [
    brand("PRIVACY POOLS"),
    chalk.dim("A compliant way to transact privately on Ethereum."),
    versionLine,
    "",
    ...actionLines,
  ];

  // Nudge from-source users to register the CLI commands on their PATH.
  if (shouldShowPathRegistrationHint(options.packageRoot)) {
    lines.push(
      "",
      chalk.dim("  Running from source? Register the CLI on your PATH:"),
      chalk.dim("    npm link"),
    );
  }

  lines.push(
    "",
    notice("This CLI is experimental. Use at your own risk."),
    notice("For large transactions, use privacypools.com."),
  );

  return lines.join("\n");
}

// ── Guide Topics ────────────────────────────────────────────────────────────

export const GUIDE_TOPICS = [
  { name: "quickstart", description: "Install, setup, and first deposit" },
  { name: "keys", description: "Two-key model (recovery phrase + signer key)" },
  { name: "workflow", description: "Step-by-step workflow for deposits and withdrawals" },
  { name: "flow-states", description: "Flow state machine and transitions" },
  { name: "ragequit", description: "Public recovery to the deposit address" },
  { name: "automation", description: "Global flags, env vars, and agent/CI integration" },
  { name: "env-vars", description: "Environment variable fallbacks and overrides" },
  { name: "next-actions", description: "How nextActions guide agent follow-up" },
  { name: "profiles", description: "Named profiles and wallet/config separation" },
  { name: "pool-accounts", description: "Pool Account states, approval, and recovery" },
  { name: "agents", description: "Agent mode, discovery, and machine workflows" },
  { name: "json", description: "JSON envelope, field selection, and JMESPath filtering" },
  { name: "modes", description: "Confirmation, dry-run, unsigned, and agent modes" },
  { name: "troubleshooting", description: "Common issues and fixes" },
  { name: "exit-codes", description: "CLI exit codes by category" },
] as const;

export type GuideTopic = (typeof GUIDE_TOPICS)[number]["name"];

const GUIDE_TOPIC_NAMES = GUIDE_TOPICS.map((t) => t.name);
const GUIDE_TOPIC_ALIASES: Record<string, GuideTopic> = {
  automation: "automation",
  agent: "agents",
  agents: "agents",
  env: "env-vars",
  "env-vars": "env-vars",
  envvars: "env-vars",
  "next-actions": "next-actions",
  nextactions: "next-actions",
  profiles: "profiles",
  "pool-account": "pool-accounts",
  "pool-accounts": "pool-accounts",
  poolaccounts: "pool-accounts",
};

export function resolveGuideTopic(topic?: string): GuideTopic | null {
  if (!topic) return null;
  const normalized = topic.trim().toLowerCase();
  if (!normalized) return null;
  if (GUIDE_TOPIC_NAMES.includes(normalized as GuideTopic)) {
    return normalized as GuideTopic;
  }
  return GUIDE_TOPIC_ALIASES[normalized] ?? null;
}

export function isGuideTopic(topic?: string): boolean {
  return resolveGuideTopic(topic) !== null;
}

// ── Guide section builders (keyed by topic) ────────────────────────────────

const guideSections: Record<string, () => string[]> = {
  quickstart: () => [
    chalk.bold("Install & Run"),
    `  ${accent("npm i -g privacy-pools-cli")}`,
    `  ${accent("npm i -g github:0xmatthewb/privacy-pools-cli")}  ${chalk.dim("(unreleased/source builds)")}`,
    `  ${accent("privacy-pools status")}`,
    `  ${accent("privacy-pools upgrade --check")}                ${chalk.dim("(check npm for a newer installed release)")}`,
    `  ${accent("npm run dev -- status")}                        ${chalk.dim("(from source, no global install)")}`,
    `  ${accent("privacy-pools completion --help")}                  ${chalk.dim("(shell autocomplete setup)")}`,
    "",
    chalk.bold("Quick Start"),
    `  ${accent("privacy-pools init")}`,
    `  ${accent("privacy-pools init --recovery-phrase-file <downloaded-file>")} ${chalk.dim("(load an existing account from a website export)")}`,
    `  ${accent("cat <downloaded-file> | privacy-pools init --recovery-phrase-stdin")} ${chalk.dim("(stdin alternative for loading an account)")}`,
    `  ${accent("privacy-pools init --signer-only")} ${chalk.dim("(finish setup or replace the signer key without changing the account)")}`,
    `  ${accent("privacy-pools flow start 0.1 ETH --to 0xRecipient")}          ${chalk.dim("(easy path: deposit now, withdraw later)")}`,
    `  ${accent("privacy-pools flow start 100 USDC --to 0xRecipient --new-wallet")}  ${chalk.dim("(easy path with a dedicated workflow wallet)")}`,
    `  ${accent("privacy-pools pools")}                                          ${chalk.dim("(browse available pools)")}`,
    `  ${accent("privacy-pools deposit 0.1 ETH")}`,
    `  ${accent("privacy-pools accounts --chain mainnet --pending-only")}        ${chalk.dim("(poll ASP review; keep the same --chain until it disappears)")}`,
    `  ${accent("privacy-pools accounts --chain mainnet")}                       ${chalk.dim("(then confirm approved vs declined vs POA Needed)")}`,
    `  ${accent("privacy-pools withdraw 0.05 ETH --to 0xRecipient --pool-account PA-1")}`,
    chalk.dim("  Transaction commands use your default chain (set during init)."),
    chalk.dim("  Public dashboards like pools/activity/stats default to CLI-supported mainnet chains."),
    chalk.dim("  Use --include-testnets to include supported testnets, or --chain to scope one network."),
    chalk.dim("  Accounts is wallet-dependent: use --chain to keep approval checks on the same network as the deposit."),
    "",
    chalk.dim("  Deposits are reviewed by the 0xBow ASP before approval."),
    chalk.dim(`  ${DEPOSIT_APPROVAL_TIMELINE_COPY}`),
    chalk.dim("  ASP approval is required for withdraw, including --direct. Ragequit is your"),
    chalk.dim("  self-custody guarantee, always available to publicly recover funds to the"),
    chalk.dim("  original deposit address. Declined saved easy-path workflows use"),
    chalk.dim("  'flow ragequit' as their canonical public recovery path, and operators can"),
    chalk.dim("  also choose it manually after the public deposit exists."),
  ],

  keys: () => [
    chalk.bold("Recovery Phrase and Signer Key"),
    `  ${notice("Recovery phrase")}  restores this Privacy Pools account and enables private withdrawals`,
    `  ${notice("Signer key")}       pays gas and sends transactions (can be set later with init --signer-only)`,
    `  The signer key may come from the same wallet as your recovery phrase or from a separate key you control.`,
    `  Note: ${notice("PRIVACY_POOLS_PRIVATE_KEY")} env var takes precedence over a saved key file.`,
    `  Exception: ${accent("flow start --new-wallet")} creates and uses a dedicated per-workflow wallet instead of the configured signer.`,
  ],

  workflow: () => [
    chalk.bold("Workflow"),
    `  1. ${accent("init")}           Set up your Privacy Pools account and config (run once)`,
    `  2. ${accent("flow start")}     Easy path: deposit now and save a later private withdrawal`,
    `  3. ${accent("flow watch")}     Resume a saved workflow through funding, approval, delay, and withdrawal`,
    `  4. ${accent("flow ragequit")}  Self-custody recovery for saved workflows (always available)`,
    `  5. ${accent("pools")}          Manual path: browse available pools`,
    `  6. ${accent("deposit")}        Manual path: deposit into a pool (ASP vetting fee shown before confirming)`,
    `  7. ${accent("accounts")}       Manual path: poll pending review, then confirm approval status and balances`,
    `  8. ${accent("migrate status")} Read-only legacy check on CLI-supported chains`,
    `  9. ${accent("withdraw")}       Manual path: withdraw privately (once approved; fee shown before confirming)`,
    ` 10. ${accent("history")}        View transaction history`,
    `  *  ${accent("status")}         Check setup and connection health (checks run by default)`,
    `  *  ${accent("upgrade")}        Check npm for updates or upgrade this CLI`,
    `  *  ${accent("activity")}       Public onchain feed ${chalk.dim("(for your history, use 'history')")}`,
    `  *  ${accent("ragequit")}       Self-custody guarantee. Publicly recovers funds to deposit address (alias: exit)`,
    `  *  ${accent("withdraw quote")} Check relayer fees before withdrawing`,
    chalk.dim("  'migrate status' is read-only. The CLI does not submit migration transactions; use the website for actual migration or website-based recovery."),
    chalk.dim("  It only checks chains currently supported by the CLI; review beta or website-only legacy migration surfaces in the website."),
    chalk.dim("  'flow start --new-wallet' generates a dedicated workflow wallet and waits for funding automatically."),
    chalk.dim("  In machine mode, this path requires '--export-new-wallet <path>' so the generated key is backed up first."),
    chalk.dim("  Manual commands remain available for advanced control."),
  ],

  ragequit: () => [
    chalk.bold("Ragequit / Public Recovery"),
    `  ${accent("privacy-pools ragequit ETH --pool-account PA-1")}`,
    `  ${accent("privacy-pools flow ragequit latest")}`,
    "",
    chalk.dim("  Ragequit publicly recovers a Pool Account to the original deposit address."),
    chalk.dim("  It is your self-custody fallback when ASP approval is unavailable, a saved"),
    chalk.dim("  flow is declined, the relayer minimum blocks a saved full-balance withdrawal,"),
    chalk.dim("  or you explicitly choose public recovery instead of waiting."),
    "",
    chalk.dim("  This does not provide privacy for that Pool Account. Prefer withdraw or"),
    chalk.dim("  flow watch when the account can continue through the private relayed path."),
    chalk.dim("  In the website this corresponds to the Exit path."),
  ],

  "flow-states": () => [
    chalk.bold("Flow States"),
    `  ${notice("awaiting_funding")}                    Workflow wallet needs ETH/tokens to proceed.`,
    `  ${notice("depositing_publicly")}                 Deposit transaction submitted, awaiting onchain confirmation.`,
    `  ${notice("awaiting_asp")}                        Deposit confirmed, ASP is reviewing.`,
    `  ${notice("approved_waiting_privacy_delay")}      Approved; privacy delay timer running.`,
    `  ${notice("approved_ready_to_withdraw")}          Ready for private withdrawal.`,
    `  ${notice("withdrawing")}                         Withdrawal transaction in flight.`,
    `  ${notice("completed")}                           Private withdrawal succeeded.`,
    `  ${notice("completed_public_recovery")}           Ragequit recovery completed.`,
    `  ${notice("paused_poa_required")}                 Proof of Association needed before private withdrawal.`,
    `  ${notice("paused_declined")}                     Deposit declined; use flow ragequit for public recovery.`,
    `  ${notice("stopped_external")}                    Workflow stopped by external event.`,
  ],

  automation: () => [
    chalk.bold("Global Options"),
    `  ${notice("-c, --chain <name>")}    Target chain (mainnet, arbitrum, optimism; testnets: sepolia, op-sepolia)`,
    `  ${notice("-r, --rpc-url <url>")}   Override RPC URL`,
    `  ${notice("-j, --json")}            Machine-readable JSON output`,
    `  ${notice("--format <fmt>")}        ${OUTPUT_FORMAT_DESCRIPTION}`,
    `  ${notice("--no-color")}            Disable colored output (also respects NO_COLOR env var)`,
    `  ${notice("-y, --yes")}             Skip confirmation prompts`,
    `  ${notice("-q, --quiet")}           Suppress human-oriented stderr output`,
    `  ${notice("-v, --verbose")}         Enable verbose/debug output (-v info, -vv debug, -vvv trace)`,
    `  ${notice("--no-progress")}         Suppress spinners/progress indicators (useful in CI)`,
    `  ${notice("--no-header")}          Suppress header rows in CSV and wide/tabular table output`,
    `  ${notice("--agent")}               Alias for --json --yes --quiet (agent/automation mode)`,
    `  ${notice("--timeout <seconds>")}  Network/transaction timeout (default: 30)`,
    `  ${notice("--jmes <expr>")}        Filter JSON output with JMESPath syntax`,
    `  ${notice("--jq <expr>")}          Compatibility alias for --jmes (not jq syntax)`,
    `  ${notice("--template <template>")} Render structured output through a lightweight {{path.to.value}} template`,
    `  ${notice("--web")}                 Open the primary explorer or portal link in your browser when available`,
    `  ${notice("--no-banner")}           Disable ASCII banner`,
    `  ${notice("--profile <name>")}     Use a named profile (separate wallet identity and config)`,
    "",
    chalk.bold("Environment Variables"),
    `  ${notice("PRIVACY_POOLS_PRIVATE_KEY")}   Signer key (takes precedence over saved signer key file)`,
    `  ${notice("PRIVACY_POOLS_HOME / PRIVACY_POOLS_CONFIG_DIR")}  Config directory override (default: ~/.privacy-pools)`,
    `  ${notice("XDG_CONFIG_HOME")}       Fallback config base when no override or legacy directory exists`,
    `  ${notice("PRIVACY_POOLS_RPC_URL / PP_RPC_URL")}             Override RPC endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_ASP_HOST / PP_ASP_HOST")}           Override ASP endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_RELAYER_HOST / PP_RELAYER_HOST")}   Override relayer endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_RPC_URL_<CHAIN> / PP_RPC_URL_<CHAIN>")}         Override RPC endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_ASP_HOST_<CHAIN> / PP_ASP_HOST_<CHAIN>")}       Override ASP endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_RELAYER_HOST_<CHAIN> / PP_RELAYER_HOST_<CHAIN>")} Override relayer endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_CIRCUITS_DIR")}   Override the circuit artifact directory`,
    `  ${notice("NO_COLOR")}                     Disable colored output (same as --no-color)`,
    `  ${notice("PP_NO_UPDATE_CHECK")}           Set to 1 to disable the update-available notification`,
    `  ${notice("PRIVACY_POOLS_AGENT")}          Default to --agent semantics`,
    `  ${notice("PRIVACY_POOLS_QUIET")}          Default to --quiet semantics`,
    `  ${notice("PRIVACY_POOLS_YES")}            Default to --yes semantics`,
    `  ${notice("PRIVACY_POOLS_NO_PROGRESS")}    Default to --no-progress semantics`,
    "",
    chalk.bold("Interaction Modes"),
    "  Human mode (default): interactive prompts + readable output.",
    "  Agent mode: --agent for structured JSON output, no prompts, no banners.",
    "  Equivalent to --json --yes --quiet.",
    "",
    chalk.bold("Advanced Modes"),
    "  Unsigned mode builds transaction payloads without signing or submitting.",
    "  Requires init (recovery phrase) for deposit secret generation.",
    "  Does NOT require a signer key. The signing party provides their own.",
    `  Output includes ${chalk.dim("from")} plus ${chalk.dim("description")}. ${chalk.dim("from")} is null when the signer is unconstrained, and set when the protocol requires a specific caller.`,
    `  ${notice("--unsigned")}           (default) Wrapped in JSON envelope: { schemaVersion, success, ... }`,
    `  ${notice("--unsigned tx")}        Raw transaction array: [{ from, to, data, value, valueHex, chainId, description }]`,
    "             Raw format skips the envelope. Intended for direct piping to signing tools.",
    `  ${notice("--dry-run")}    Validate and generate proofs without submitting.`,
  ],

  "env-vars": () => [
    chalk.bold("Environment Variable Fallbacks"),
    `  ${notice("PRIVACY_POOLS_AGENT")}       Enable agent mode by default (${chalk.dim("--agent")})`,
    `  ${notice("PRIVACY_POOLS_QUIET")}       Suppress human stderr by default (${chalk.dim("--quiet")})`,
    `  ${notice("PRIVACY_POOLS_YES")}         Skip confirmations by default (${chalk.dim("--yes")})`,
    `  ${notice("PRIVACY_POOLS_NO_PROGRESS")} Suppress spinners by default (${chalk.dim("--no-progress")})`,
    `  ${notice("NO_COLOR")}                  Disable color (${chalk.dim("--no-color")})`,
    "",
    chalk.bold("Configuration Overrides"),
    `  ${notice("PRIVACY_POOLS_HOME / PRIVACY_POOLS_CONFIG_DIR")}  Config directory override`,
    `  ${notice("XDG_CONFIG_HOME")}       Fallback config base when no override or legacy directory exists`,
    `  ${notice("PRIVACY_POOLS_PRIVATE_KEY")}   Signer key (takes precedence over saved signer key file)`,
    `  ${notice("PRIVACY_POOLS_RPC_URL / PP_RPC_URL")}             Override RPC endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_ASP_HOST / PP_ASP_HOST")}           Override ASP endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_RELAYER_HOST / PP_RELAYER_HOST")}   Override relayer endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_RPC_URL_<CHAIN> / PP_RPC_URL_<CHAIN>")}         Override RPC endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_ASP_HOST_<CHAIN> / PP_ASP_HOST_<CHAIN>")}       Override ASP endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_RELAYER_HOST_<CHAIN> / PP_RELAYER_HOST_<CHAIN>")} Override relayer endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_CIRCUITS_DIR")} Override the packaged circuit artifact directory`,
    `  ${notice("PP_NO_UPDATE_CHECK")}       Disable update notifications when set to 1`,
  ],

  "next-actions": () => [
    chalk.bold("nextActions"),
    "  Success JSON responses may include nextActions[] when the CLI has a low-ambiguity follow-up to recommend.",
    "  Each entry includes command, reason, when, cliCommand, args?, options?, and runnable?.",
    "",
    chalk.bold("Runnable Semantics"),
    "  runnable=true  The cliCommand is complete and can be executed as-is.",
    "  runnable=false The action is a template; fill in missing user input first.",
    "",
    chalk.bold("Ordering"),
    "  The first matching action is the highest-priority recommendation.",
    "  Private/resume paths come first, required public recovery comes before optional public recovery, and template deposit/withdraw actions come last.",
    "",
    chalk.bold("Common Uses"),
    `  ${accent("privacy-pools deposit --agent")}         Emits the canonical pending-review polling command.`,
    `  ${accent("privacy-pools status --agent")}          Emits the canonical init/pools/accounts follow-up.`,
    `  ${accent("privacy-pools flow watch --agent")}      Emits resume, manual follow-up, or ragequit guidance.`,
  ],

  profiles: () => [
    chalk.bold("Profiles"),
    "  Profiles let one machine keep separate Privacy Pools config, wallet state, and signer setup under different names.",
    `  Use ${notice("--profile <name>")} on any command to select one profile for that invocation.`,
    "",
    chalk.bold("Commands"),
    `  ${accent("privacy-pools config profile list")}`,
    `  ${accent("privacy-pools config profile create <name>")}`,
    `  ${accent("privacy-pools config profile use <name>")}`,
    `  ${accent("privacy-pools config profile active")}`,
    "",
    chalk.bold("When To Use Them"),
    "  Use profiles when you need separate operator identities, separate test/main workflows, or isolated machine-runner state on one host.",
  ],

  "pool-accounts": () => [
    chalk.bold("Pool Accounts"),
    "  A Pool Account (PA) is one deposit and its remaining balance lineage.",
    "  Approval and withdrawal happen per Pool Account, not per wallet.",
    "",
    chalk.bold("Statuses"),
    `  ${successTone("approved")}       Ready for private withdrawal`,
    `  ${notice("pending")}        Still under ASP review`,
    `  ${notice("poa_required")}   Proof of Association is required before private withdrawal`,
    `  ${dangerTone("declined")}       Private withdrawal unavailable; ragequit remains available`,
    `  ${chalk.dim("spent")}          Already withdrawn`,
    `  ${chalk.dim("exited")}         Ragequit completed`,
    "",
    chalk.bold("Useful Commands"),
    `  ${accent("privacy-pools accounts --chain <chain>")}`,
    `  ${accent("privacy-pools withdraw --pool-account PA-1 --to 0xRecipient")}`,
    `  ${accent("privacy-pools ragequit --pool-account PA-1")}`,
    `  ${accent("privacy-pools migrate status --agent --include-testnets")}  ${chalk.dim("(legacy readiness only)")}`,
  ],

  agents: () => [
    chalk.bold("Agent Mode"),
    `  ${notice("--agent")} is shorthand for ${chalk.dim("--json --yes --quiet")}.`,
    "  Structured JSON stays on stdout. Human-oriented narration stays on stderr and is suppressed in agent mode.",
    "",
    chalk.bold("Discovery"),
    `  ${accent("privacy-pools capabilities --agent")}      Full runtime capability manifest`,
    `  ${accent("privacy-pools describe withdraw --agent")} Command-specific flags, risks, and JSON fields`,
    `  ${accent("privacy-pools describe envelope.shared.nextAction --agent")} Deep contract schema lookup`,
    `  ${accent("privacy-pools guide next-actions --agent")} Shared nextActions contract`,
    "",
    chalk.bold("Recommended Flow"),
    `  1. ${accent("privacy-pools status --agent")}`,
    `  2. ${accent("privacy-pools init --agent --default-chain <chain> --backup-file <path>")}`,
    `  3. ${accent("privacy-pools pools --agent --chain <chain>")}`,
    `  4. ${accent("privacy-pools flow start <amount> <asset> --to <address> --agent --chain <chain>")}`,
    `  5. ${accent("privacy-pools flow watch latest --agent")}`,
  ],

  json: () => [
    chalk.bold("JSON Contract"),
    "  Use --json for machine-readable output. Use --agent for --json --yes --quiet.",
    "  Successful commands emit:",
    `  ${notice('{ "schemaVersion": "2.0.0", "success": true, ...payload }')}`,
    "  Failed commands emit:",
    `  ${notice('{ "schemaVersion": "2.0.0", "success": false, "errorCode": "...", "error": { ... } }')}`,
    "",
    chalk.bold("Filtering"),
    `  ${notice("--json-fields <fields>")}  Select top-level fields by comma-separated name.`,
    `  ${notice("--jmes <expression>")}     Apply a JMESPath expression to the final envelope.`,
    `  ${notice("--jq <expression>")}       Compatibility alias for --jmes (not jq syntax).`,
    `  ${notice("--template <template>")}   Interpolate the final envelope with {{path.to.value}} placeholders.`,
    "  Unknown --json-fields fail with INPUT_UNKNOWN_JSON_FIELD, availableFields[], and did-you-mean suggestions when available.",
    "  Invalid JMESPath expressions fail before command output is emitted.",
    "  --json-fields, --jmes/--jq, and --template are mutually exclusive.",
    "",
    chalk.bold("Discovery"),
    `  ${accent("privacy-pools capabilities --agent")}      Full command and schema manifest.`,
    `  ${accent("privacy-pools describe withdraw --agent")} Command-specific fields and examples.`,
    `  ${accent("privacy-pools describe envelope.shared.nextAction --agent")} Deep contract schema fragments.`,
  ],

  modes: () => [
    chalk.bold("Modes"),
    `  ${notice("--yes")}       Skip confirmation prompts. Use only after the command inputs are fully reviewed.`,
    `  ${notice("--dry-run")}   Preview validation and generated outputs without signing or submitting.`,
    `  ${notice("--unsigned")}  Build transaction payloads without signing or submitting; implies --yes.`,
    `  ${notice("--agent")}     Machine mode: --json --yes --quiet.`,
    "",
    chalk.bold("Safety Notes"),
    "  --dry-run and --unsigned may use approximate validation because no transaction is submitted.",
    "  Fund-moving commands still surface warnings and privacy-cost manifests where relevant.",
    "  Prefer relayed withdrawals. withdraw --direct is a stronger privacy hazard than ragequit.",
  ],

  troubleshooting: () => [
    chalk.bold("Troubleshooting"),
    "  Stale data?      Commands auto-sync; force a full re-sync with 'privacy-pools sync'.",
    "  ASP unreachable?  Check 'privacy-pools status' (health checks run by default).",
    "  Long proof time?  Proofs use bundled circuit artifacts. The first proof may spend a moment verifying them.",
    "  Native fallback?  Set PRIVACY_POOLS_CLI_DISABLE_NATIVE=1 to force the JS launcher,",
    "                   or see docs/runtime-upgrades.md for runtime troubleshooting and overrides.",
    `  Upgrade path?     Run ${accent("privacy-pools upgrade")} to check npm for updates or upgrade this CLI.`,
    "  Not approved?     Deposits are reviewed by the ASP.",
    `                   ${DEPOSIT_APPROVAL_TIMELINE_COPY}`,
    "                   Some may require Proof of Association or be",
    "                   declined. Declined deposits can be recovered",
    "                   publicly via ragequit.",
    "  Custom RPC?       Pass --rpc-url on any command, or save per-chain overrides in",
    `                   ~/.privacy-pools/config.json under ${chalk.dim('"rpcOverrides": { "<chainId>": "https://..." }')}.`,
  ],

  "exit-codes": () => [
    chalk.bold("Exit Codes"),
    `  ${successTone("0")}  Success`,
    `  ${dangerTone("1")}  Unknown/general error`,
    `  ${dangerTone("2")}  Input/validation error`,
    `  ${dangerTone("3")}  RPC/network error`,
    `  ${dangerTone("4")}  ASP error`,
    `  ${dangerTone("5")}  Relayer error`,
    `  ${dangerTone("6")}  Proof generation error`,
    `  ${dangerTone("7")}  Contract revert`,
  ],
};

// Sections included only in the full guide (no dedicated topic).
function guideAppendixSections(): string[] {
  return [
    "",
    chalk.bold("Using CLI with an Existing Website Account"),
    `  If you already use ${accent("privacypools.com")}, you can access the same account from the CLI:`,
    `  1. Export your 12/24-word recovery phrase from the website.`,
    `  2. Run: ${accent("privacy-pools init --recovery-phrase-file ./recovery.txt")} ${chalk.dim("(or: cat recovery.txt | privacy-pools init --recovery-phrase-stdin)")}`,
    `  3. Set your signer key: ${accent("export PRIVACY_POOLS_PRIVATE_KEY=0x...")}`,
    `  4. Run: ${accent("privacy-pools accounts")}  ${chalk.dim("(syncs onchain state automatically)")}`,
    `  If the website account was created before the 2024 security update, run ${accent("privacy-pools migrate status")} to inspect legacy readiness on CLI-supported chains. Review beta or website-only legacy migration surfaces in the website.`,
    "",
    chalk.bold("Terminology"),
    `  ${notice("Recovery phrase")}          24-word mnemonic by default in the CLI; imports may be 12/24 words.`,
    `  ${notice("Signer key")}               Private key that pays gas and sends transactions.`,
    `  ${notice("Pool Account (PA)")}        A single deposit and its balance, tracked for withdrawal or exit.`,
    `  ${notice("0xBow ASP status")}  ${successTone("approved")} (withdraw ready), ${notice("pending")} (waiting),`,
    `                                   ${notice("poa_required")} (Proof of Association needed),`,
    `                                   ${dangerTone("declined")} (ragequit available), ${chalk.dim("unknown")} (unresolved).`,
    `  ${notice("Relayed withdrawal")}       Privacy-preserving withdrawal via a relayer (recommended).`,
    `  ${notice("Direct withdrawal")}        Non-private withdrawal; links deposit and withdrawal onchain.`,
    `  ${notice("Ragequit (exit alias)")}    Self-custody guarantee. Public, irreversible recovery to original deposit address.`,
    "",
    chalk.bold("Agent Integration"),
    `  For programmatic/agent use, run ${accent("privacy-pools capabilities --agent")} to discover`,
    "  commands, schemas, supported chains, error codes, and the recommended workflow.",
    `  Use ${accent("privacy-pools describe <command...> --agent")} to inspect one command at runtime.`,
    "",
    chalk.bold("Further Reading"),
    `  ${accent("privacy-pools <command> --help")}  ${chalk.dim("(command-specific details and examples)")}`,
    chalk.dim("  Package-relative docs (open from a source checkout or installed package root):"),
    `  ${accent("docs/reference.md")}   Flags, configuration, environment variables, project structure`,
    `  ${accent("docs/runtime-upgrades.md")}  Native runtime troubleshooting, fallback controls, upgrade playbook`,
    `  ${accent("AGENTS.md")}           Agent integration guide, JSON payloads, unsigned mode`,
    `  ${accent("CHANGELOG.md")}        Release history and migration notes`,
    "",
    chalk.dim("  Run privacy-pools <command> --help for command-specific details."),
  ];
}

/**
 * Return guide text for a specific topic, or the full guide if no topic given.
 */
export function guideText(topic?: string): string {
  if (topic) {
    const resolvedTopic = resolveGuideTopic(topic);
    const builder = resolvedTopic ? guideSections[resolvedTopic] : undefined;
    if (!builder) {
      const available = GUIDE_TOPICS.map((t) => `  ${accent(t.name)}  ${chalk.dim(t.description)}`).join("\n");
      return [
        `Unknown guide topic: ${topic}`,
        "",
        "Available topics",
        available,
        "",
        chalk.dim("  Run 'privacy-pools guide' with no topic for the full guide."),
      ].join("\n");
    }
    return [accentBold(`Privacy Pools: ${resolvedTopic}`), "", ...builder()].join("\n");
  }

  // Full guide: all sections + appendix.
  const allLines: string[] = [accentBold("Privacy Pools: Quick Guide"), ""];
  for (const { name } of GUIDE_TOPICS) {
    allLines.push(...guideSections[name](), "");
  }
  allLines.push(...guideAppendixSections());
  return allLines.join("\n");
}

export type HelpExample = string | { category: string; commands: string[] };

export interface CommandHelpConfig {
  overview?: string[];
  examples?: HelpExample[];
  prerequisites?: string;
  jsonFields?: string;
  jsonVariants?: string[];
  supportsUnsigned?: boolean;
  supportsDryRun?: boolean;
  safetyNotes?: string[];
  agentWorkflowNotes?: string[];
  seeAlso?: string[];
}

export const helpTestInternals = {
  defaultPackageRoot,
  shouldShowPathRegistrationHint,
};

export function commandHelpText(config: CommandHelpConfig): string {
  const lines: string[] = [];

  if (config.overview && config.overview.length > 0) {
    lines.push("", ...config.overview);
  }

  if (config.examples && config.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of config.examples) {
      if (typeof example === "string") {
        lines.push(`  ${example}`);
      } else {
        lines.push(`  ${example.category}:`);
        for (const cmd of example.commands) {
          lines.push(`    ${cmd}`);
        }
      }
    }
  }

  if (config.prerequisites) {
    lines.push("", "Prerequisites:");
    lines.push(`  Requires: ${config.prerequisites}`);
  }

  if (config.safetyNotes && config.safetyNotes.length > 0) {
    lines.push("", "Safety notes:");
    for (const note of config.safetyNotes) {
      lines.push(`  ${note}`);
    }
  }

  if (config.agentWorkflowNotes && config.agentWorkflowNotes.length > 0) {
    lines.push("", "Agent workflow:");
    for (const note of config.agentWorkflowNotes) {
      lines.push(`  ${note}`);
    }
  }

  if (config.jsonFields || (config.jsonVariants && config.jsonVariants.length > 0)) {
    lines.push("", "JSON output (--json):");
    if (config.jsonFields) {
      lines.push(`  ${config.jsonFields}`);
    }
    for (const variant of config.jsonVariants ?? []) {
      lines.push(`  ${variant}`);
    }
  }

  if (config.supportsUnsigned || config.supportsDryRun) {
    lines.push("", "Modes:");
    lines.push("  --yes skips confirmation prompts.");
    if (config.supportsUnsigned) {
      lines.push("  --unsigned builds transaction payloads without signing or submitting; implies --yes.");
    }
    if (config.supportsDryRun) {
      lines.push("  --dry-run previews only; confirmations still apply in human mode.");
    }
    lines.push("  --agent is shorthand for --json --yes --quiet.");
  }

  if (config.seeAlso && config.seeAlso.length > 0) {
    lines.push("", "See also:");
    for (const ref of config.seeAlso) {
      lines.push(`  privacy-pools ${ref}`);
    }
  }

  return lines.join("\n");
}
