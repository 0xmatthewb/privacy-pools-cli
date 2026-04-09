import chalk from "chalk";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "./approval-timing.js";
import { accent, accentBold, brand, dangerTone, notice, successTone } from "./theme.js";
import { inlineSeparator } from "./terminal.js";
export { styleCommanderHelp } from "./root-help.js";

function defaultPackageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function shouldShowPathRegistrationHint(
  packageRoot: string = defaultPackageRoot(),
): boolean {
  return Boolean(process.env.npm_lifecycle_event) && existsSync(join(packageRoot, ".git"));
}

/**
 * Condensed welcome screen shown on bare `privacy-pools` (no args).
 * Orients the user quickly without the full Commander listing.
 */
export function welcomeScreen(
  options: { packageRoot?: string; version?: string } = {},
): string {
  const version = options.version?.trim();
  const sep = inlineSeparator();
  const versionLine = version
    ? `${chalk.dim(`v${version}`)}${chalk.dim(sep)}${accent("privacypools.com")}`
    : accent("privacypools.com");

  const lines = [
    brand("PRIVACY POOLS"),
    chalk.dim("A compliant way to transact privately on Ethereum."),
    versionLine,
    "",
    `${accent("privacy-pools init")}    ${chalk.dim("get started")}`,
    `${accent("privacy-pools guide")}   ${chalk.dim("full guide")}`,
    `${accent("privacy-pools --help")}  ${chalk.dim("all commands")}`,
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

/**
 * Full guide content - displayed by `privacy-pools guide`.
 * Contains the quick start, workflow, automation tips, and exit codes
 * that used to live in root --help.
 */
export function guideText(): string {
  return [
    accentBold("Privacy Pools: Quick Guide"),
    "",
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
    `  ${accent("privacy-pools flow start 0.1 ETH --to 0xRecipient")}          ${chalk.dim("(easy path: deposit now, withdraw later)")}`,
    `  ${accent("privacy-pools flow start 100 USDC --to 0xRecipient --new-wallet")}  ${chalk.dim("(easy path with a dedicated workflow wallet)")}`,
    `  ${accent("privacy-pools pools")}                                          ${chalk.dim("(browse available pools)")}`,
    `  ${accent("privacy-pools deposit 0.1 ETH")}`,
    `  ${accent("privacy-pools accounts --chain mainnet --pending-only")}        ${chalk.dim("(poll ASP review; keep the same --chain until it disappears)")}`,
    `  ${accent("privacy-pools accounts --chain mainnet")}                       ${chalk.dim("(then confirm approved vs declined vs POA Needed)")}`,
    `  ${accent("privacy-pools withdraw 0.05 ETH --to 0xRecipient --from-pa PA-1")}`,
    chalk.dim("  Transaction commands use your default chain (set during init)."),
    chalk.dim("  Public dashboards like pools/activity/stats default to all CLI-supported mainnet chains unless you pass --chain."),
    chalk.dim("  Accounts is wallet-dependent: use --chain to keep approval checks on the same network as the deposit."),
    "",
    chalk.dim("  Deposits are reviewed by the ASP (Association Set Provider) before approval."),
    chalk.dim(`  ${DEPOSIT_APPROVAL_TIMELINE_COPY}`),
    chalk.dim("  ASP approval is required for withdraw, including --direct. If a deposit is"),
    chalk.dim("  declined, use ragequit for public recovery to the original deposit address."),
    chalk.dim("  Declined saved easy-path workflows use 'flow ragequit' as their canonical"),
    chalk.dim("  public recovery path, and operators can also choose it manually after the"),
    chalk.dim("  public deposit exists."),
    "",
    chalk.bold("Two-Key Model"),
    `  Privacy Pools uses two keys:`,
    `  ${notice("Recovery phrase")}  keeps your deposits private (generated during init; sometimes called a seed phrase)`,
    `  ${notice("Signer key")}       pays gas and sends transactions (can be set later)`,
    `  These are independent. You can set the signer key later via env var.`,
    `  Note: ${notice("PRIVACY_POOLS_PRIVATE_KEY")} env var takes precedence over a saved key file.`,
    `  Exception: ${accent("flow start --new-wallet")} creates and uses a dedicated per-workflow wallet instead of the configured signer.`,
    "",
    chalk.bold("Workflow"),
    `  1. ${accent("init")}           Set up wallet and config (run once)`,
    `  2. ${accent("flow start")}     Easy path: deposit now and save a later private withdrawal`,
    `  3. ${accent("flow watch")}     Resume a saved workflow through funding, approval, delay, and withdrawal`,
    `  4. ${accent("flow ragequit")}  Saved-workflow public recovery if you stop waiting or the easy path is declined`,
    `  5. ${accent("pools")}          Manual path: browse available pools`,
    `  6. ${accent("deposit")}        Manual path: deposit into a pool (vetting fee shown before confirming)`,
    `  7. ${accent("accounts")}       Manual path: poll pending review, then confirm approval status and balances`,
    `  8. ${accent("migrate status")} Read-only legacy check on CLI-supported chains`,
    `  9. ${accent("withdraw")}       Manual path: withdraw privately (once approved; fee shown before confirming)`,
    ` 10. ${accent("history")}        View transaction history`,
    `  *  ${accent("status")}         Check setup and connection health (checks run by default)`,
    `  *  ${accent("upgrade")}        Check npm for updates or upgrade this CLI`,
    `  *  ${accent("activity")}       Public onchain feed ${chalk.dim("(for your history, use 'history')")}`,
    `  *  ${accent("ragequit")}       Public withdrawal. Returns funds to deposit address (alias: exit)`,
    `  *  ${accent("withdraw quote")} Check relayer fees before withdrawing`,
    chalk.dim("  'migrate status' is read-only. The CLI does not submit migration transactions; use the website for actual migration or website-based recovery."),
    chalk.dim("  It only checks chains currently supported by the CLI; review beta or website-only legacy migration surfaces in the website."),
    chalk.dim("  'flow start --new-wallet' generates a dedicated workflow wallet and waits for funding automatically."),
    chalk.dim("  In machine mode, this path requires '--export-new-wallet <path>' so the generated key is backed up first."),
    chalk.dim("  Manual commands remain available for advanced control."),
    "",
    chalk.bold("Global Options"),
    `  ${notice("-c, --chain <name>")}    Target chain (mainnet, arbitrum, optimism; testnets: sepolia, op-sepolia)`,
    `  ${notice("-r, --rpc-url <url>")}   Override RPC URL`,
    `  ${notice("-j, --json")}            Machine-readable JSON output`,
    `  ${notice("--format <fmt>")}        Output format: table (default), csv, json`,
    `  ${notice("--no-color")}            Disable colored output (also respects NO_COLOR env var)`,
    `  ${notice("-y, --yes")}             Skip confirmation prompts`,
    `  ${notice("-q, --quiet")}           Suppress human-oriented stderr output`,
    `  ${notice("-v, --verbose")}         Enable verbose/debug output`,
    `  ${notice("--agent")}               Alias for --json --yes --quiet (agent/automation mode)`,
    `  ${notice("--timeout <seconds>")}  Network/transaction timeout (default: 30)`,
    `  ${notice("--no-banner")}           Disable ASCII banner`,
    "",
    chalk.bold("Environment Variables"),
    `  ${notice("PRIVACY_POOLS_PRIVATE_KEY")}   Signer key (takes precedence over saved signer key file)`,
    `  ${notice("PRIVACY_POOLS_HOME / PRIVACY_POOLS_CONFIG_DIR")}  Config directory override (default: ~/.privacy-pools)`,
    `  ${notice("PRIVACY_POOLS_RPC_URL / PP_RPC_URL")}             Override RPC endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_ASP_HOST / PP_ASP_HOST")}           Override ASP endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_RELAYER_HOST / PP_RELAYER_HOST")}   Override relayer endpoint for all chains`,
    `  ${notice("PRIVACY_POOLS_RPC_URL_<CHAIN> / PP_RPC_URL_<CHAIN>")}         Override RPC endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_ASP_HOST_<CHAIN> / PP_ASP_HOST_<CHAIN>")}       Override ASP endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_RELAYER_HOST_<CHAIN> / PP_RELAYER_HOST_<CHAIN>")} Override relayer endpoint per chain`,
    `  ${notice("PRIVACY_POOLS_CIRCUITS_DIR")}   Override the circuit artifact directory`,
    `  ${notice("NO_COLOR")}                     Disable colored output (same as --no-color)`,
    `  ${notice("PP_NO_UPDATE_CHECK")}           Set to 1 to disable the update-available notification`,
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
    "",
    chalk.bold("Troubleshooting"),
    "  Stale data?      Commands auto-sync; force a full re-sync with 'privacy-pools sync'.",
    "  ASP unreachable?  Check 'privacy-pools status' (health checks run by default).",
    "  Long proof time?  Proofs use bundled circuit artifacts. The first proof may spend a moment verifying them.",
    "  Native fallback?  Set PRIVACY_POOLS_CLI_DISABLE_NATIVE=1 to force the JS launcher,",
    "                   or see docs/runtime-upgrades.md for runtime troubleshooting and overrides.",
    `  Upgrade path?     Run ${accent("privacy-pools upgrade")} to check npm for updates or upgrade this CLI.`,
    "  Not approved?     Deposits are reviewed by the ASP. Most deposits are",
    "                   approved within 1 hour, but some may take longer",
    "                   (up to 7 days). Some may require Proof of Association",
    "                   or be declined. Declined deposits must use ragequit",
    "                   for public recovery.",
    "  Custom RPC?       Pass --rpc-url on any command, or save per-chain overrides in",
    `                   ~/.privacy-pools/config.json under ${chalk.dim('"rpcOverrides": { "<chainId>": "https://..." }')}.`,
    "",
    chalk.bold("Exit Codes"),
    `  ${successTone("0")}  Success`,
    `  ${dangerTone("1")}  Unknown/general error`,
    `  ${dangerTone("2")}  Input/validation error`,
    `  ${dangerTone("3")}  RPC/network error`,
    `  ${dangerTone("4")}  ASP (Association Set Provider) error`,
    `  ${dangerTone("5")}  Relayer error`,
    `  ${dangerTone("6")}  Proof generation error`,
    `  ${dangerTone("7")}  Contract revert`,
    "",
    chalk.bold("Using CLI with an Existing Website Account"),
    `  If you already use ${accent("privacypools.com")}, you can access the same account from the CLI:`,
    `  1. Export your 12/24-word recovery phrase from the website.`,
    `  2. Run: ${accent("privacy-pools init --recovery-phrase-file ./recovery.txt")} ${chalk.dim("(or: cat recovery.txt | privacy-pools init --recovery-phrase-stdin)")}`,
    `  3. Set your signer key: ${accent("export PRIVACY_POOLS_PRIVATE_KEY=0x...")}`,
    `  4. Run: ${accent("privacy-pools accounts")}  ${chalk.dim("(syncs on-chain state automatically)")}`,
    `  If the website account was created before the 2024 security update, run ${accent("privacy-pools migrate status")} to inspect legacy readiness on CLI-supported chains. Review beta or website-only legacy migration surfaces in the website.`,
    "",
    chalk.bold("Terminology"),
    `  ${notice("Recovery phrase")}          24-word mnemonic by default in the CLI; imports may be 12/24 words.`,
    `  ${notice("Signer key")}               Private key that pays gas and sends transactions.`,
    `  ${notice("Pool Account (PA)")}        A single deposit and its balance, tracked for withdrawal or exit.`,
    `  ${notice("ASP (Association Set Provider) status")}  ${successTone("approved")} (withdraw ready), ${notice("pending")} (waiting),`,
    `                                   ${notice("poi_required")} (Proof of Association needed),`,
    `                                   ${dangerTone("declined")} (ragequit only), ${chalk.dim("unknown")} (unresolved).`,
    `  ${notice("Relayed withdrawal")}       Privacy-preserving withdrawal via a relayer (recommended).`,
    `  ${notice("Direct withdrawal")}        Non-private withdrawal; links deposit and withdrawal onchain.`,
    `  ${notice("Ragequit (exit alias)")}    Public, irreversible withdrawal to original deposit address.`,
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
  ].join("\n");
}

export interface CommandHelpConfig {
  overview?: string[];
  examples?: string[];
  prerequisites?: string;
  jsonFields?: string;
  jsonVariants?: string[];
  supportsUnsigned?: boolean;
  supportsDryRun?: boolean;
  safetyNotes?: string[];
  agentWorkflowNotes?: string[];
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
      lines.push(`  ${example}`);
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
    lines.push("", "Additional modes:");
    if (config.supportsUnsigned) {
      lines.push("  --unsigned builds transaction payloads without submitting.");
    }
    if (config.supportsDryRun) {
      lines.push("  --dry-run validates the operation without submitting it.");
    }
  }

  return lines.join("\n");
}
