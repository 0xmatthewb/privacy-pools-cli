import { CHAINS, CHAIN_NAMES, POA_PORTAL_URL } from "../config/chains.js";
import {
  buildRuntimeCompatibilityDescriptor,
  CLI_PROTOCOL_PROFILE,
} from "../config/protocol-profile.js";
import { readCliPackageInfo } from "../package-info.js";
import { jsonContractDocRelativePath } from "./json.js";
import { ROOT_GLOBAL_FLAG_METADATA } from "./root-global-flags.js";
import type {
  CapabilitiesPayload,
  CommandExecutionDescriptor,
  CommandLatencyClass,
  CommandSideEffectClass,
  DetailedCommandDescriptor,
  PreferredSafeVariant,
} from "../types.js";
import type { CommandHelpConfig } from "./help.js";

const CLI_PACKAGE_INFO = readCliPackageInfo(import.meta.url);

export type CommandPath =
  | "init"
  | "upgrade"
  | "flow"
  | "flow start"
  | "flow watch"
  | "flow status"
  | "flow ragequit"
  | "pools"
  | "activity"
  | "stats"
  | "stats global"
  | "stats pool"
  | "status"
  | "capabilities"
  | "describe"
  | "guide"
  | "deposit"
  | "withdraw"
  | "withdraw quote"
  | "ragequit"
  | "accounts"
  | "migrate"
  | "migrate status"
  | "history"
  | "sync"
  | "completion";

type CapabilityEntry = CapabilitiesPayload["commands"][number];

interface CommandCapabilityMetadata
  extends Omit<CapabilityEntry, "name" | "description" | "aliases"> {
  name?: string;
}

interface CommandDescriptorSeed {
  description: string;
  aliases: string[];
  usage: string;
  flags: string[];
  globalFlags: string[];
  requiresInit: boolean;
  expectedLatencyClass: CommandLatencyClass;
  safeReadOnly: boolean;
  sideEffectClass: CommandSideEffectClass;
  touchesFunds: boolean;
  requiresHumanReview: boolean;
  preferredSafeVariant?: PreferredSafeVariant;
  prerequisites: string[];
  examples: string[];
  jsonFields: string | null;
  jsonVariants: string[];
  safetyNotes: string[];
  supportsUnsigned: boolean;
  supportsDryRun: boolean;
  agentWorkflowNotes: string[];
}

export interface CommandMetadata {
  description: string;
  aliases?: string[];
  help?: CommandHelpConfig;
  capabilities?: CommandCapabilityMetadata;
  execution?: CommandExecutionDescriptor;
  safeReadOnly?: boolean;
  agentsDocMarker?: string;
}

export interface GlobalFlagMetadata {
  flag: string;
  description: string;
}

export const COMMAND_METADATA: Record<CommandPath, CommandMetadata> = {
  init: {
    description: "Initialize wallet and configuration",
    help: {
      examples: [
        "privacy-pools init",
        "privacy-pools init --yes --default-chain mainnet",
        "privacy-pools init --force --yes --default-chain mainnet",
        "privacy-pools init --agent --default-chain mainnet --show-mnemonic",
        "privacy-pools init --mnemonic-file ./my-mnemonic.txt --private-key-file ./my-key.txt",
        "cat phrase.txt | privacy-pools init --mnemonic-stdin --yes --default-chain mainnet",
        "printf '%s\\n' 0x... | privacy-pools init --mnemonic-file ./my-mnemonic.txt --private-key-stdin --yes --default-chain mainnet",
      ],
      jsonFields:
        "{ defaultChain, signerKeySet, recoveryPhraseRedacted? | recoveryPhrase?, warning?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      safetyNotes: [
        "The recovery phrase and signer key are independent secrets: the phrase controls deposit privacy, the key pays gas. Neither is derived from the other.",
        "Newly generated recovery phrases use 24 words (256-bit entropy). Imported recovery phrases may still be 12 or 24 words.",
        "Legacy pre-upgrade accounts may need website migration or website-based recovery before the CLI can safely restore them.",
      ],
      agentWorkflowNotes: [
        "When generating a new recovery phrase in machine mode, pass --show-mnemonic and capture it immediately.",
        "When importing an existing recovery phrase, nextActions points to migrate status --agent --all-chains first so the CLI can check legacy migration or website-recovery readiness before restoring account state.",
      ],
    },
    capabilities: {
      flags: [
        "--mnemonic <phrase>",
        "--mnemonic-file <path>",
        "--mnemonic-stdin",
        "--private-key <key>",
        "--private-key-file <path>",
        "--private-key-stdin",
        "--default-chain <chain>",
        "--force",
        "--show-mnemonic",
      ],
      agentFlags: "--agent --default-chain <chain> --show-mnemonic",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    agentsDocMarker: "#### `init`",
  },
  upgrade: {
    description: "Check npm for updates or upgrade this CLI",
    help: {
      overview: [
        "Checks npm for the latest published privacy-pools-cli version and can upgrade a supported global npm install in place.",
        "Automatic upgrade is supported only for recognized global npm installs. Source checkouts, Bun global installs, local project installs, npx-style ephemeral runs, CI, and other ambiguous contexts never mutate; the CLI returns manual guidance plus an exact follow-up npm command.",
        "Machine modes (--json / --agent) stay check-only unless --yes is also present.",
      ],
      examples: [
        "privacy-pools upgrade --check",
        "privacy-pools upgrade",
        "privacy-pools upgrade --yes",
        "privacy-pools upgrade --agent --check",
        "privacy-pools upgrade --agent --yes",
      ],
      jsonFields:
        "{ mode: \"upgrade\", status, currentVersion, latestVersion, updateAvailable, performed, command|null, installContext: { kind, supportedAutoRun, reason }, installedVersion|null }",
      safetyNotes: [
        "Automatic upgrade only runs for recognized global npm installs of privacy-pools-cli.",
        "Source checkouts, Bun global installs, local project installs, npx-style ephemeral runs, CI, and ambiguous contexts stay read-only and still return an exact npm follow-up command.",
        "A successful upgrade updates the installed CLI on disk but does not hot-reexec the current process. Re-run privacy-pools after it completes.",
      ],
      agentWorkflowNotes: [
        "In machine modes, upgrade is check-only unless --yes is explicitly present.",
        "Treat status = ready as an available update on a supported global npm install, status = manual as an available update requiring manual follow-up, and status = upgraded as a completed install that still requires a fresh CLI invocation.",
      ],
    },
    capabilities: {
      flags: ["--check"],
      agentFlags: "--agent [--check] [--yes]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: false,
    agentsDocMarker: "#### `upgrade`",
  },
  flow: {
    description: "Run the easy-path deposit-to-withdraw workflow",
    help: {
      overview: [
        "Adds a persisted easy path on top of the same public deposit, ASP review, and relayed private withdrawal flow used by the website and manual CLI commands.",
        "`privacyDelayConfigured = false` in flow JSON means a legacy saved workflow was normalized to `off` without an explicitly saved privacy-delay policy.",
        "Manual commands remain unchanged and are still the advanced/manual path when you need custom Pool Account selection, partial amounts, direct withdrawals, unsigned payloads, or dry-runs.",
      ],
      examples: [
        "privacy-pools flow start 0.1 ETH --to 0xRecipient...",
        "privacy-pools flow start 0.1 ETH --to 0xRecipient... --watch",
        "privacy-pools flow start 100 USDC --to 0xRecipient... --new-wallet --export-new-wallet ./flow-wallet.txt",
        "privacy-pools flow watch",
        "privacy-pools flow status latest",
        "privacy-pools flow ragequit latest",
      ],
      prerequisites: "init for start/watch/ragequit; saved workflow for status",
    },
    capabilities: {
      usage: "flow",
      flags: ["start <amount> <asset> --to <address>", "watch [workflowId|latest]", "status [workflowId|latest]", "ragequit [workflowId|latest]"],
      agentFlags:
        "start <amount> <asset> --to <address> [--privacy-delay <profile>] --agent (or: watch [workflowId|latest] [--privacy-delay <profile>] --agent; status/ragequit --agent)",
      requiresInit: false,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: false,
  },
  "flow start": {
    description: "Deposit now and save a later private withdrawal workflow",
    help: {
      overview: [
        "This is the compressed happy-path command: it performs the normal public deposit, saves a workflow locally, and targets a later relayed private withdrawal (the relayer submits the withdrawal onchain) from that same Pool Account (the saved deposit lineage) to the saved recipient.",
        "With --new-wallet, the CLI generates a dedicated workflow wallet, waits for it to be funded, then continues automatically. ETH flows wait for the full ETH target; ERC20 flows wait for the token amount plus native ETH gas reserve.",
        "The saved workflow always spends the full remaining balance from the newly created Pool Account. The recipient receives the net amount after relayer fees and any ERC20 extra-gas funding, and the workflow never auto-ragequits.",
      ],
      examples: [
        "privacy-pools flow start 0.1 ETH --to 0xRecipient...",
        "privacy-pools flow start 0.1 ETH --to 0xRecipient... --privacy-delay off",
        "privacy-pools flow start 100 USDC --to 0xRecipient... --chain mainnet",
        "privacy-pools flow start 100 USDC --to 0xRecipient... --new-wallet --export-new-wallet ./flow-wallet.txt",
        "privacy-pools flow start 0.1 ETH --to 0xRecipient... --watch --agent",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"start\", workflowId, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, warnings?: [{ code, category: \"privacy\", message }], lastError?, nextActions? }",
      safetyNotes: [
        "The deposit is still public and reviewed by the ASP before private withdrawal is possible.",
        "If --to is omitted in interactive mode, the CLI prompts for the recipient. In machine modes, --to remains required.",
        "In machine modes, non-round flow amounts are rejected. Use a round amount in agent/non-interactive runs, or switch to interactive mode if you intentionally accept that tradeoff.",
        "New workflows default to a balanced post-approval privacy delay before relayed withdrawal. off = no added hold, balanced = randomized 15 to 90 minutes, aggressive = randomized 2 to 12 hours.",
        "Vetting fees can turn a round deposit input into a non-round committed balance, so flow start may still emit an advisory amount-pattern warning for the later full-balance auto-withdrawal.",
        "flow start surfaces advisory privacy warnings when the saved workflow is configured to auto-withdraw a full non-round balance, or when timing delay is explicitly disabled.",
        "--export-new-wallet is only valid with --new-wallet.",
        "Non-interactive workflow wallets require --export-new-wallet so the generated private key is backed up before the flow starts.",
        "The generated workflow key is also stored locally under workflow-secrets until the workflow completes or recovers publicly, so --export-new-wallet is a backup copy rather than the only retained secret.",
        "Dedicated workflow wallets may retain leftover asset balance or gas reserve after paused or terminal states, so check them manually before assuming they are empty.",
        "The saved flow spends the entire remaining Pool Account balance, but the recipient receives the net amount after relayer fees and any ERC20 extra-gas funding.",
        "Manual commands remain the advanced/manual path when you need custom control over Pool Account selection, amount, or withdrawal mode.",
      ],
      agentWorkflowNotes: [
        "With --new-wallet, the flow stays attached automatically and waits for funding, deposit, approval, and withdrawal unless you detach with Ctrl-C.",
        "Use --watch to stay attached on configured-wallet workflows; otherwise the workflow is persisted locally and flow watch <workflowId> is the canonical resume path.",
      ],
    },
    capabilities: {
      usage: "flow start <amount> <asset> --to <address>",
      flags: [
        "--to <address>",
        "--privacy-delay <profile>",
        "--watch",
        "--new-wallet",
        "--export-new-wallet <path>",
      ],
      agentFlags:
        "--agent [--privacy-delay <profile>] [--watch] [--new-wallet] [--export-new-wallet <path>]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
  },
  "flow watch": {
    description:
      "Resume a saved flow through funding, approval, delay, and withdrawal",
    help: {
      overview: [
        "Re-checks a saved workflow using the same protocol realities as the frontend. It can resume dedicated-wallet funding, public deposit reconciliation, ASP review, privacy-delay waiting, relayed withdrawal, and pending receipt reconciliation.",
        "Workflow phases include awaiting_funding, depositing_publicly, awaiting_asp, approved_waiting_privacy_delay, approved_ready_to_withdraw, withdrawing, completed, completed_public_recovery, paused_poi_required, paused_declined, and stopped_external.",
        "The saved workflow phase is reported in phase, while the deposit review state from the ASP (the approval service) remains available separately in aspStatus.",
        "When a saved workflow is using balanced or aggressive privacy delay, approval first transitions into approved_waiting_privacy_delay until the persisted randomized hold expires.",
        "Ctrl-C detaches cleanly. It does not cancel the saved workflow or mutate it beyond any state that was already persisted.",
        "flow watch is intentionally unbounded. Agents that need a wall-clock limit should wrap the command in their own external timeout.",
      ],
      examples: [
        "privacy-pools flow watch",
        "privacy-pools flow watch latest --privacy-delay off   # updates the saved privacy-delay policy",
        "privacy-pools flow watch latest --agent",
        "privacy-pools flow watch 123e4567-e89b-12d3-a456-426614174000",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"watch\", workflowId, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, warnings?: [{ code, category: \"privacy\", message }], lastError?, nextActions? }",
      safetyNotes: [
        "Paused states are successful workflow states, not CLI errors. Declined workflows surface flow ragequit as the canonical public recovery path, and PoA-required workflows can either resume privately after the external Proof of Association step or recover publicly with flow ragequit.",
        "If the saved full-balance withdrawal falls below the relayer minimum, flow watch surfaces flow ragequit as the required public recovery path because saved flows only support relayed private withdrawals.",
        "Once the public deposit exists, operators can also choose flow ragequit manually instead of waiting, but it is not emitted as the default nextAction while the workflow is still progressing normally. The happy-path canonical resume command remains flow watch.",
        "Passing --privacy-delay on flow watch updates the saved workflow policy. off = no added hold, balanced = randomized 15 to 90 minutes, aggressive = randomized 2 to 12 hours.",
        "Switching to off clears any saved hold immediately; switching between balanced and aggressive resamples from the override time.",
      ],
      agentWorkflowNotes: [
        "New-wallet workflows wait for funding automatically. ERC20 workflows require both the token amount and a native ETH gas reserve in the generated wallet before the public deposit can proceed.",
        "When the saved Pool Account is approved, flow watch performs the relayed private withdrawal automatically using the saved recipient and the full remaining balance of that same Pool Account after any configured privacy delay hold expires.",
        "flow watch keeps polling until the saved workflow changes or finishes. If your automation should stop after a fixed duration, wrap the CLI call in your own external timeout.",
      ],
    },
    capabilities: {
      usage: "flow watch [workflowId|latest]",
      flags: ["[workflowId|latest]", "--privacy-delay <profile>"],
      agentFlags: "--agent [--privacy-delay <profile>]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
  },
  "flow status": {
    description: "Show the saved easy-path workflow state",
    help: {
      overview: [
        "Reads the persisted workflow snapshot and prints the current saved phase plus the canonical next action.",
        "This is a saved local snapshot only. Run flow watch to re-check live state and advance the workflow.",
        "When using latest, the CLI fails closed if unreadable saved workflow files could be newer than the latest readable workflow.",
        "This is read-only and does not require init if the saved workflow already exists locally.",
      ],
      examples: [
        "privacy-pools flow status",
        "privacy-pools flow status latest --agent",
        "privacy-pools flow status 123e4567-e89b-12d3-a456-426614174000",
      ],
      prerequisites: "saved workflow (usually created after init)",
      jsonFields:
        "{ mode: \"flow\", action: \"status\", workflowId, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, warnings?: [{ code, category: \"privacy\", message }], lastError?, nextActions? }",
    },
    capabilities: {
      usage: "flow status [workflowId|latest]",
      flags: ["[workflowId|latest]"],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "flow ragequit": {
    description: "Recover a saved workflow publicly via ragequit",
    help: {
      overview: [
        "Uses the saved workflow context to perform the public recovery path without changing any manual commands.",
        "Once the public deposit exists, flow ragequit remains available as an optional public recovery path until the workflow reaches a terminal state. Declined flows use it as the canonical recovery path.",
        "If a saved full-balance workflow can no longer satisfy the relayer minimum, flow ragequit becomes the required recovery path because the saved flow only supports relayed private withdrawal.",
        "For workflow wallets, this uses the stored per-workflow private key. For configured-wallet workflows, it must use the original depositor signer that created the saved flow.",
      ],
      examples: [
        "privacy-pools flow ragequit",
        "privacy-pools flow ragequit latest --agent",
        "privacy-pools flow ragequit 123e4567-e89b-12d3-a456-426614174000",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"ragequit\", workflowId, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, lastError?, nextActions? }",
      safetyNotes: [
        "This is a public recovery path. It exits to the original deposit address and does not preserve privacy.",
        "Configured-wallet recovery only works when the current signer still matches the original depositor address saved with the workflow.",
      ],
    },
    capabilities: {
      usage: "flow ragequit [workflowId|latest]",
      flags: ["[workflowId|latest]"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
  },
  pools: {
    description: "List available pools and assets",
    help: {
      examples: [
        "privacy-pools pools",
        "privacy-pools pools ETH",
        "privacy-pools pools BOLD --chain mainnet",
        "privacy-pools pools --all-chains --sort tvl-desc",
        "privacy-pools pools --search usdc --sort asset-asc",
        "privacy-pools pools --agent --chain mainnet",
      ],
      jsonFields:
        "{ chain?, allChains?, chains?, search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, totalDepositsCount, totalDepositsValue, acceptedDepositsValue, pendingDepositsValue, ... }], warnings? }",
      jsonVariants: [
        "detail (<asset>): { chain, asset, tokenAddress, pool, scope, ..., myFunds?, myFundsWarning?, recentActivity? }",
        "detail myFunds: { balance, usdValue, poolAccounts, pendingCount, poiRequiredCount, declinedCount, accounts: [{ id, status, aspStatus, value }] }",
      ],
      agentWorkflowNotes: [
        "In pools JSON, 'asset' is the symbol for CLI follow-up commands and 'tokenAddress' is the contract address.",
      ],
    },
    capabilities: {
      flags: ["--all-chains", "--search <query>", "--sort <mode>"],
      agentFlags: "--agent [--all-chains] [--search <query>] [--sort <mode>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `pools`",
  },
  activity: {
    description: "Show public activity feed",
    help: {
      examples: [
        "privacy-pools activity",
        "privacy-pools activity --page 2 --limit 20",
        "privacy-pools activity --asset ETH",
        "privacy-pools activity --asset USDC --agent --chain mainnet",
      ],
      jsonFields:
        "{ mode, chain, chains?, page, perPage, total, totalPages, chainFiltered?, note?, asset?, pool?, scope?, events: [{ type, txHash, explorerUrl, reviewStatus, amountRaw, amountFormatted, poolSymbol, poolAddress, chainId, timestamp }] }",
    },
    capabilities: {
      flags: ["--asset <symbol|address>", "--page <n>", "--limit <n>"],
      agentFlags: "--agent [--asset <symbol>] [--page <n>] [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `activity`",
  },
  stats: {
    description: "Show public statistics",
    help: {
      examples: [
        "privacy-pools stats global",
        "privacy-pools stats pool --asset ETH",
        "privacy-pools stats pool --asset USDC --agent --chain mainnet",
      ],
    },
    capabilities: {
      usage: "stats",
      flags: ["global", "pool --asset <symbol|address>"],
      agentFlags: "global --agent (or: pool --asset <symbol> --agent)",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,
  },
  "stats global": {
    description: "Show global Privacy Pools statistics (all-time and last 24h)",
    help: {
      overview: [
        "Always returns aggregate cross-chain statistics. The --chain flag is not supported; use stats pool --asset <symbol> --chain <chain> for chain-specific data.",
      ],
      examples: [
        "privacy-pools stats global",
        "privacy-pools stats global --agent",
      ],
      jsonFields:
        "{ mode, chain, chains?, cacheTimestamp?, allTime?, last24h?, perChain?: [{ chain, cacheTimestamp, allTime, last24h }] }",
    },
    capabilities: {
      usage: "stats global",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `stats global`",
  },
  "stats pool": {
    description: "Show statistics for a specific pool (all-time and last 24h)",
    help: {
      examples: [
        "privacy-pools stats pool --asset ETH",
        "privacy-pools stats pool --asset USDC --agent --chain mainnet",
      ],
      jsonFields: "{ mode, chain, asset, pool, scope, cacheTimestamp?, allTime?, last24h? }",
    },
    capabilities: {
      usage: "stats pool --asset <symbol|address>",
      flags: ["--asset <symbol|address>"],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `stats pool`",
  },
  status: {
    description: "Show configuration and check connection health",
    help: {
      overview: [
        "Use recommendedMode plus blockingIssues[]/warnings[] for machine gating, and keep readyForDeposit/readyForWithdraw/readyForUnsigned as configuration capability flags only.",
        "When status falls back to recommendedMode = read-only because RPC health is degraded, nextActions stays on public discovery and avoids account-state guidance until connectivity is restored.",
        "When only the ASP is degraded but RPC is healthy, status still keeps nextActions on public discovery, while warning that public recovery remains available through ragequit or flow ragequit if the operator already knows the affected account or workflow.",
      ],
      examples: [
        "privacy-pools status",
        "privacy-pools status --check",
        "privacy-pools status --no-check",
        "privacy-pools status --agent --check-rpc",
        "privacy-pools status --chain mainnet --rpc-url https://...",
      ],
      jsonFields:
        "{ configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, recoveryPhraseSet, signerKeySet, signerKeyValid, signerAddress, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned, recommendedMode, blockingIssues?, warnings?, nextActions?: [{ command, reason, when, args?, options?, runnable? }], aspLive?, rpcLive?, rpcBlockNumber? }",
    },
    capabilities: {
      flags: ["--check", "--no-check", "--check-rpc", "--check-asp"],
      agentFlags: "--agent [--no-check] [--check-rpc] [--check-asp]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `status`",
  },
  capabilities: {
    description: "Describe CLI capabilities for agent discovery",
    help: {
      examples: [
        "privacy-pools capabilities",
        "privacy-pools capabilities --agent",
      ],
      jsonFields:
        "{ commands[], commandDetails{}, executionRoutes{}, globalFlags[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], protocol{}, runtime{}, safeReadOnlyCommands[], jsonOutputContract, documentation?: { reference, agentGuide, changelog, runtimeUpgrades, jsonContract } }",
    },
    capabilities: {
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `capabilities`",
  },
  describe: {
    description: "Describe one command for runtime agent introspection",
    help: {
      examples: [
        "privacy-pools describe withdraw",
        "privacy-pools describe withdraw quote --agent",
        "privacy-pools describe stats global --agent",
      ],
      jsonFields:
        "{ command, description, aliases, usage, flags, globalFlags, requiresInit, expectedLatencyClass, safeReadOnly, sideEffectClass, touchesFunds, requiresHumanReview, preferredSafeVariant?, prerequisites, examples, jsonFields, jsonVariants, safetyNotes, supportsUnsigned, supportsDryRun, agentWorkflowNotes }",
    },
    capabilities: {
      usage: "describe <command...>",
      flags: ["<command...>"],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `describe`",
  },
  guide: {
    description: "Show usage guide, workflow, and reference",
    help: {
      examples: [
        "privacy-pools guide",
        "privacy-pools guide --agent",
      ],
      jsonFields: "{ mode: \"help\", help }",
    },
    capabilities: {
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  deposit: {
    description: "Deposit into a pool",
    help: {
      examples: [
        "privacy-pools deposit 0.1 ETH",
        "privacy-pools deposit 100 USDC",
        "privacy-pools deposit 0.05 ETH --agent",
        "privacy-pools deposit 0.1 ETH --unsigned",
        "privacy-pools deposit 0.1 ETH --dry-run",
        "privacy-pools deposit 0.1 --asset ETH --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ operation, txHash, amount, committedValue, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber, explorerUrl, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, precommitment, transactions[] }",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, precommitment, balanceSufficient }",
      ],
      safetyNotes: [
        "Deposits are reviewed by the ASP before approval. Most approve within 1 hour; some may take up to 7 days.",
        "A vetting fee is deducted from the deposit amount by the pool's ASP.",
        `Only approved deposits can use withdraw, whether relayed or direct. Declined deposits must use ragequit/exit publicly. Deposits that require Proof of Association (PoA) must complete the PoA flow at ${POA_PORTAL_URL} before they can withdraw privately.`,
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        `Poll accounts --chain <chain> --pending-only while the Pool Account remains pending; when it disappears from pending results, re-run accounts --chain <chain> to confirm whether aspStatus became approved, declined, or requires Proof of Association. Withdraw only after approval; ragequit if declined; complete Proof of Association at ${POA_PORTAL_URL} first if needed. Always preserve the same --chain scope for both polling and confirmation.`,
        "If the deposit transaction was submitted but confirmation timed out or the CLI was interrupted afterward, run sync --chain <chain> before retrying so local state can reconcile the onchain deposit.",
      ],
    },
    capabilities: {
      usage: "deposit <amount> [asset]",
      flags: [
        "--asset <symbol|address>",
        "--unsigned [envelope|tx]",
        "--dry-run",
        "--ignore-unique-amount",
      ],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `deposit`",
  },
  withdraw: {
    description: "Withdraw from a pool",
    help: {
      examples: [
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient... --from-pa PA-2",
        "privacy-pools withdraw --all ETH --to 0xRecipient...",
        "privacy-pools withdraw 50% ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.1 ETH --to 0xRecipient... --dry-run",
        "privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...",
        "privacy-pools withdraw 0.05 ETH --to 0xRecipient... --chain mainnet",
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Always prefer relayed withdrawals (the default). Direct withdrawals (--direct) are NOT privacy-preserving: they publicly link your deposit address and withdrawal address onchain. Only use --direct if you understand and accept the privacy trade-off.",
        "ASP approval is required for both relayed and direct withdrawals. Declined deposits must ragequit publicly to the original deposit address.",
        "Relayed withdrawals must also respect the relayer minimum. If a withdrawal would leave a positive remainder below that minimum, the CLI warns so you can withdraw less, use --all/100%, or choose a public recovery path later.",
      ],
      jsonFields:
        "{ operation, mode, txHash, blockNumber, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS, extraGas?, remainingBalance, anonymitySet?: { eligible, total, percentage }, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      jsonVariants: [
        "direct: same fields but mode: \"direct\", feeBPS: null, no extraGas, and human output explains the onchain link between deposit and withdrawal.",
        "quote: { mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, relayTxCost, extraGas?, extraGasFundAmount?, extraGasTxCost?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
        "--unsigned: { mode, operation, withdrawMode, chain, transactions[], ... }",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { operation, mode, dryRun, amount, asset, chain, recipient, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, feeBPS?, quoteExpiresAt?, extraGas?, anonymitySet?: { eligible, total, percentage } }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "If the CLI is interrupted after proof generation but before submission completes, re-run withdraw to generate a fresh proof and re-evaluate the current account state.",
        "If a direct or relayed withdrawal transaction was submitted but confirmation timed out, run sync --chain <chain> before retrying so local state can reconcile the onchain result.",
      ],
    },
    capabilities: {
      usage: "withdraw [amount] [asset] --to <address>",
      flags: [
        "--asset <symbol|address>",
        "--to <address>",
        "--from-pa <PA-#>",
        "--all",
        "--direct",
        "--extra-gas",
        "--no-extra-gas",
        "--unsigned [envelope|tx]",
        "--dry-run",
      ],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `withdraw`",
  },
  "withdraw quote": {
    description: "Request relayer quote and limits without generating a proof",
    help: {
      examples: [
        "privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...",
        "privacy-pools withdraw quote 100 USDC --agent --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, relayTxCost, extraGas?, extraGasFundAmount?, extraGasTxCost?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      agentWorkflowNotes: [
        "Quotes expire quickly; submit the withdrawal promptly after quoting if the fee is acceptable. Check runnable=false on nextActions for template commands that still need required user input.",
      ],
    },
    capabilities: {
      usage: "withdraw quote <amount|asset> [amount]",
      flags: ["--asset <symbol|address>", "--to <address>"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "medium",
    },

    agentsDocMarker: "**Withdrawal quote:**",
  },
  ragequit: {
    description: "Publicly withdraw funds to your deposit address",
    aliases: ["exit"],
    help: {
      examples: [
        "privacy-pools ragequit ETH --from-pa PA-1",
        "privacy-pools ragequit ETH --unsigned --from-pa PA-1",
        "privacy-pools ragequit ETH --dry-run --from-pa PA-1",
        "privacy-pools ragequit ETH --from-pa PA-1 --chain mainnet",
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Ragequit is public and irreversible and reveals the original deposit address onchain.",
      ],
      jsonFields:
        "{ operation, txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber, explorerUrl, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, transactions[] }",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "If the public recovery transaction was submitted but confirmation timed out, re-run ragequit or sync --chain <chain> before retrying so the CLI can reconcile the onchain result.",
      ],
    },
    capabilities: {
      usage: "ragequit [asset] --from-pa <PA-#>",
      flags: [
        "--asset <symbol|address>",
        "--from-pa <PA-#>",
        "--unsigned [envelope|tx]",
        "--dry-run",
      ],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `ragequit`",
  },
  accounts: {
    description: "List your Pool Accounts (individual deposit lineages) with balances",
    help: {
      examples: [
        "privacy-pools accounts",
        "privacy-pools accounts --all-chains",
        "privacy-pools accounts --details",
        "privacy-pools accounts --summary",
        "privacy-pools accounts --chain <name> --pending-only",
        "privacy-pools accounts --agent",
        "privacy-pools accounts --no-sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, allChains?, chains?, warnings?, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash, explorerUrl, chain?, chainId? }], balances: [{ asset, balance, usdValue, poolAccounts, chain?, chainId? }], pendingCount, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      jsonVariants: [
        "--summary: { chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poiRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions? }",
        "--pending-only: { chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions? }",
      ],
      agentWorkflowNotes: [
        "Without --chain, accounts aggregates all CLI-supported mainnet chains by default. Use --all-chains to include testnets.",
        "Use --summary or --pending-only to reduce JSON size for polling loops.",
        `When a Pool Account disappears from --pending-only results, re-run accounts without --pending-only to confirm whether it was approved, declined, or requires Proof of Association (${POA_PORTAL_URL}) before choosing withdraw or ragequit.`,
      ],
    },
    capabilities: {
      flags: ["--no-sync", "--all-chains", "--details", "--summary", "--pending-only"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `accounts`",
  },
  migrate: {
    description: "Inspect legacy migration readiness on CLI-supported chains",
    help: {
      overview: [
        "Read-only command for legacy pre-upgrade accounts on chains currently supported by the CLI. It rebuilds the legacy account view from the installed SDK plus current onchain events, then reports whether the Privacy Pools website migration flow or website-based recovery is needed.",
        "The CLI does not submit legacy migrations. Use the Privacy Pools website for actual migration or website-based recovery.",
      ],
      examples: [
        "privacy-pools migrate status",
        "privacy-pools migrate status --chain mainnet",
        "privacy-pools migrate status --all-chains --agent",
      ],
      prerequisites: "init",
    },
    capabilities: {
      usage: "migrate",
      flags: ["status [--all-chains]"],
      agentFlags: "status --agent [--all-chains]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,
  },
  "migrate status": {
    description: "Show legacy migration readiness on CLI-supported chains",
    help: {
      overview: [
        "Reconstructs the legacy account view without persisting local account state, using the built-in CLI pool registry plus current onchain events for CLI-supported chains, then summarizes whether legacy commitments still need website migration, appear fully migrated already, or require website-based public recovery instead.",
        "Without --chain, migrate status checks all CLI-supported mainnet chains by default. Use --all-chains to include testnets.",
      ],
      examples: [
        "privacy-pools migrate status",
        "privacy-pools migrate status --chain mainnet",
        "privacy-pools migrate status --all-chains --agent",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"migration-status\", chain, allChains?, chains?, warnings?, status, requiresMigration, requiresWebsiteRecovery, isFullyMigrated, readinessResolved, submissionSupported: false, requiredChainIds, migratedChainIds, missingChainIds, websiteRecoveryChainIds, unresolvedChainIds, chainReadiness: [{ chain, chainId, status, candidateLegacyCommitments, expectedLegacyCommitments, migratedCommitments, legacyMasterSeedNullifiedCount, hasPostMigrationCommitments, isMigrated, legacySpendableCommitments, upgradedSpendableCommitments, declinedLegacyCommitments, reviewStatusComplete, requiresMigration, requiresWebsiteRecovery, scopes }] }",
      safetyNotes: [
        "This command is read-only. It never submits migration transactions and does not persist rebuilt account state.",
        "When readinessResolved is false, treat the result as incomplete and review the account in the Privacy Pools website before acting on it.",
        "This check is limited to chains currently supported by the CLI. Review beta or other website-only migration surfaces in the Privacy Pools website.",
      ],
      agentWorkflowNotes: [
        "Use this after init/import when the CLI warns that a legacy pre-upgrade account may need website migration or website-based recovery.",
      ],
    },
    capabilities: {
      usage: "migrate status",
      flags: ["--all-chains"],
      agentFlags: "--agent [--all-chains]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `migrate status`",
  },
  history: {
    description: "Show chronological event history (deposits, withdrawals, ragequits)",
    help: {
      examples: [
        "privacy-pools history",
        "privacy-pools history --limit 10",
        "privacy-pools history --agent",
        "privacy-pools history --no-sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }] }",
    },
    capabilities: {
      flags: ["--no-sync", "--limit <n>"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `history`",
  },
  sync: {
    description: "Force-sync local account state from onchain events",
    help: {
      examples: [
        "privacy-pools sync",
        "privacy-pools sync --asset ETH --agent",
        "privacy-pools sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, syncedPools, availablePoolAccounts, syncedSymbols?, previousAvailablePoolAccounts? }",
      agentWorkflowNotes: [
        "Use sync after deposit, withdraw, or ragequit confirmation timeouts before retrying. It rebuilds local account state from onchain events and prevents duplicate recovery attempts against already-confirmed transactions.",
      ],
    },
    capabilities: {
      flags: ["-a, --asset <symbol|address>"],
      agentFlags: "--agent [--asset <symbol>]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `sync`",
  },
  completion: {
    description: "Generate shell completion script",
    help: {
      examples: [
        "privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools",
        "privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools",
        "privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish",
        "privacy-pools completion powershell >> $PROFILE",
      ],
      jsonFields: "{ mode, shell, completionScript }",
    },
    capabilities: {
      flags: ["[shell]", "--shell <shell>"],
      agentFlags: "--agent <shell>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
};

function defaultExecutionMetadata(path: CommandPath): CommandExecutionDescriptor {
  if (
    path === "guide" ||
    path === "capabilities" ||
    path === "describe" ||
    path === "completion"
  ) {
    return {
      owner: "native-shell",
      nativeModes: ["default", "help"],
    };
  }

  if (path === "stats") {
    return {
      owner: "hybrid",
      nativeModes: ["default", "csv", "structured-default", "structured-global", "help"],
    };
  }

  if (path === "stats global" || path === "stats pool" || path === "activity") {
    return {
      owner: "hybrid",
      nativeModes: ["default", "csv", "structured", "help"],
    };
  }

  if (path === "pools") {
    return {
      owner: "hybrid",
      nativeModes: ["default-list", "csv-list", "structured-list", "help"],
    };
  }

  return {
    owner: "js-runtime",
    nativeModes: ["help"],
  };
}

export function getCommandExecutionMetadata(
  path: CommandPath,
): CommandExecutionDescriptor {
  const explicit = COMMAND_METADATA[path].execution;
  if (explicit) {
    return {
      owner: explicit.owner,
      nativeModes: [...explicit.nativeModes],
    };
  }

  return defaultExecutionMetadata(path);
}

export const COMMAND_PATHS = Object.keys(COMMAND_METADATA) as CommandPath[];

export const CAPABILITIES_COMMAND_ORDER: CommandPath[] = [
  "init",
  "upgrade",
  "flow",
  "flow start",
  "flow watch",
  "flow status",
  "flow ragequit",
  "pools",
  "activity",
  "stats",
  "stats global",
  "stats pool",
  "describe",
  "deposit",
  "withdraw",
  "withdraw quote",
  "accounts",
  "migrate",
  "migrate status",
  "history",
  "sync",
  "status",
  "ragequit",
  "guide",
  "completion",
  "capabilities",
];

export const GLOBAL_FLAG_METADATA: GlobalFlagMetadata[] =
  ROOT_GLOBAL_FLAG_METADATA.map(({ flag, description }) => ({
    flag,
    description,
  }));

const CHAIN_GLOBAL_FLAG = "-c, --chain <name>";

const CHAIN_UNSUPPORTED_DESCRIPTOR_COMMANDS = new Set<CommandPath>([
  "stats",
  "stats global",
]);

function supportedGlobalFlagMetadata(path: CommandPath): GlobalFlagMetadata[] {
  return GLOBAL_FLAG_METADATA.filter((entry) => {
    if (
      entry.flag === CHAIN_GLOBAL_FLAG &&
      CHAIN_UNSUPPORTED_DESCRIPTOR_COMMANDS.has(path)
    ) {
      return false;
    }
    return true;
  });
}

const AGENT_WORKFLOW = [
  "1. privacy-pools status --agent",
  "2. privacy-pools init --agent --default-chain <chain> --show-mnemonic",
  "3. privacy-pools pools --agent --chain <chain>",
  "4. privacy-pools flow start <amount> <asset> --to <address> --agent --chain <chain>",
  "5. privacy-pools flow watch [workflowId|latest] --agent",
  "6. privacy-pools flow ragequit [workflowId|latest] --agent  (optional public recovery after the deposit exists; canonical if the saved workflow is declined)",
  "7. privacy-pools deposit <amount> --asset <symbol> --agent --chain <chain>  (manual alternative)",
  "8. privacy-pools accounts --agent --chain <chain> --pending-only  (reviewed entries disappear; confirm approved vs declined vs poi_required with accounts --agent --chain <chain>)",
  "9. privacy-pools withdraw <amount> --asset <symbol> --to <address> --agent --chain <chain>",
];

const AGENT_NOTES: Record<string, string> = {
  polling:
    `After depositing, poll 'accounts --agent --chain <chain> --pending-only' while the Pool Account remains pending. Reviewed entries disappear from --pending-only results; once gone, re-run 'accounts --agent --chain <chain>' to confirm whether aspStatus is 'approved', 'declined', or 'poi_required'. Withdraw only after approval; ragequit if declined; complete Proof of Association at ${POA_PORTAL_URL} first if poi_required. Always preserve the same --chain scope for both polling and confirmation. Most deposits approve within 1 hour; some may take up to 7 days. Follow nextActions from the deposit response for the canonical polling command.`,
  withdrawQuote:
    "Use 'withdraw quote <amount> --asset <symbol> --agent' to check relayer fees before committing to a withdrawal.",
  firstRun:
    "First proof generation may provision checksum-verified circuit artifacts automatically (~60s one-time). Subsequent proofs are faster (~10-30s).",
  unsignedMode:
    "--unsigned builds transaction payloads without signing or submitting. Use --unsigned tx for a raw transaction array (no envelope). Requires init (recovery phrase) for deposit secret generation, but does NOT require a signer key. The 'from' field is included for signer-aware workflows: it is null when the signer is unconstrained, and set to the required caller address when the protocol requires one.",
  metaFlag:
    "--agent is equivalent to --json --yes --quiet. Use it to suppress all stderr output and skip prompts.",
  statusCheck:
    "Run 'status --agent' before transacting. Use recommendedMode plus blockingIssues[]/warnings[] for machine gating, and keep readyForDeposit/readyForWithdraw/readyForUnsigned as configuration capability flags only. Those flags confirm the wallet is set up, NOT that withdrawable funds exist. Check 'accounts --agent --chain <chain>' to verify fund availability before withdrawing on a specific chain. Use bare 'accounts --agent' only for the default multi-chain mainnet dashboard. When recommendedMode is read-only because RPC or ASP health is degraded, follow status nextActions back to public discovery and avoid account-state guidance until connectivity is restored. If only the ASP is down while RPC stays healthy, public recovery still remains available through ragequit, flow ragequit, or unsigned ragequit payloads when the affected account or workflow is already known.",
};

export const CAPABILITIES_SCHEMAS: Record<string, Record<string, unknown>> = {
  aspApprovalStatus: {
    values: ["approved", "pending", "poi_required", "declined", "unknown"],
    description:
      `ASP approval status for a Pool Account. 'approved' means the deposit has been vetted and is eligible for private withdrawal. 'pending' means the ASP has not yet approved the deposit. 'poi_required' means Proof of Association (${POA_PORTAL_URL}) is required before private withdrawal. 'declined' means the ASP rejected the deposit for private withdrawal. 'unknown' applies to exited or spent accounts, or when ASP status could not be determined.`,
  },
  poolAccountStatus: {
    values: ["approved", "pending", "poi_required", "declined", "unknown", "spent", "exited"],
    description:
      "User-facing status of a Pool Account. Active accounts surface their effective review state ('approved', 'pending', 'poi_required', 'declined', or 'unknown'). 'spent' means an approved account was withdrawn. 'exited' means ragequit/exit was used.",
  },
  errorCategories: {
    values: ["INPUT", "RPC", "ASP", "RELAYER", "PROOF", "CONTRACT", "UNKNOWN"],
    exitCodes: { INPUT: 2, RPC: 3, ASP: 4, RELAYER: 5, PROOF: 6, CONTRACT: 7, UNKNOWN: 1 },
    description:
      "Error responses include top-level errorCode/errorMessage plus error.{ code, category, message, hint?, retryable? }.",
  },
  unsignedOutput: {
    envelopeFormat:
      "{ schemaVersion, success, mode, operation, chain, transactions: [{ from, to, data, value, ... }], ... }",
    txFormat:
      "[{ from, to, data, value, valueHex, chainId, description }]: raw array, no envelope wrapper. Intended for direct piping to signing tools.",
    note:
      "Default --unsigned emits the envelope format. Use --unsigned tx for raw transaction array only.",
  },
  nextActions: {
    shape:
      "{ command, reason, when, args?: string[], options?: Record<string, string|number|boolean|null>, runnable?: boolean }",
    description:
      "Canonical workflow guidance for agents. Follow these command suggestions instead of parsing natural-language output. " +
      "Current nextActions are emitted only when the CLI has a low-ambiguity follow-up to recommend. " +
      "When runnable is omitted or true, the command is fully specified and can be executed as shown. " +
      "When runnable is false, the action is a template and requires additional user input before execution.",
  },
  sideEffectClass: {
    values: ["read_only", "local_state_write", "network_write", "fund_movement"],
    description:
      "Machine-readable risk classification for a command path. read_only never mutates local or remote protocol state. local_state_write may mutate local CLI state or secrets. network_write is reserved for remote mutations that do not directly move user funds. fund_movement may submit deposits, withdrawals, or public recoveries.",
  },
  statusRecommendedMode: {
    values: ["setup-required", "read-only", "unsigned-only", "ready"],
    description:
      "High-level preflight recommendation derived from the current wallet/configuration state. setup-required means init or recovery setup is incomplete. unsigned-only means read-only and unsigned transaction building are safe but a valid signer is unavailable. ready means the wallet is configured for deposits and withdrawals. read-only means status detected degraded RPC or ASP health, so public discovery is the default safe path until connectivity is restored. When only the ASP is degraded but RPC remains healthy, public recovery may still be available if the affected account or workflow is already known.",
  },
  statusIssues: {
    blockingIssueShape:
      "{ code, message, affects: (\"deposit\"|\"withdraw\"|\"unsigned\"|\"discovery\")[] }",
    warningShape:
      "{ code, message, affects: (\"deposit\"|\"withdraw\"|\"unsigned\"|\"discovery\")[] }",
    description:
      "Structured preflight issues returned by status --agent. blockingIssues describe setup blockers that should stop execution. warnings describe degraded or follow-up-worthy states that may still allow safe read-only usage.",
  },
};

const READ_ONLY_COMMANDS = new Set<CommandPath>([
  "guide",
  "capabilities",
  "describe",
  "completion",
  "pools",
  "activity",
  "stats",
  "stats global",
  "stats pool",
  "status",
  "flow status",
  "migrate",
  "migrate status",
  "withdraw quote",
]);

const LOCAL_STATE_WRITE_COMMANDS = new Set<CommandPath>([
  "upgrade",
  "init",
  "accounts",
  "history",
  "sync",
]);

const FUND_MOVEMENT_COMMANDS = new Set<CommandPath>([
  "flow",
  "flow start",
  "flow watch",
  "flow ragequit",
  "deposit",
  "withdraw",
  "ragequit",
]);

const PREFERRED_SAFE_VARIANTS: Partial<Record<CommandPath, PreferredSafeVariant>> = {
  upgrade: {
    command: "upgrade --check",
    reason: "Check for a newer npm release without mutating the installed CLI.",
  },
  flow: {
    command: "flow status",
    reason: "Inspect the saved workflow state before advancing a persisted flow.",
  },
  "flow watch": {
    command: "flow status",
    reason: "Inspect the saved workflow state before re-attaching a long-running flow.",
  },
  "flow ragequit": {
    command: "flow status",
    reason: "Inspect the saved workflow state before triggering the public recovery path.",
  },
  deposit: {
    command: "pools",
    reason: "Browse pools and balances before submitting a new deposit.",
  },
  withdraw: {
    command: "withdraw quote",
    reason: "Check relayer fees and confirm the withdrawal inputs before submitting.",
  },
};

function sideEffectClassFor(path: CommandPath): CommandSideEffectClass {
  if (FUND_MOVEMENT_COMMANDS.has(path)) {
    return "fund_movement";
  }
  if (LOCAL_STATE_WRITE_COMMANDS.has(path)) {
    return "local_state_write";
  }
  if (READ_ONLY_COMMANDS.has(path)) {
    return "read_only";
  }
  return "read_only";
}

function preferredSafeVariantFor(path: CommandPath): PreferredSafeVariant | undefined {
  return PREFERRED_SAFE_VARIANTS[path];
}

function descriptorSeed(path: CommandPath): CommandDescriptorSeed {
  const metadata = getCommandMetadata(path);
  const capabilities = metadata.capabilities;
  if (!capabilities) {
    throw new Error(`Missing capabilities metadata for command path '${path}'.`);
  }

  const sideEffectClass = sideEffectClassFor(path);
  const touchesFunds = sideEffectClass === "fund_movement";

  return {
    description: metadata.description,
    aliases: metadata.aliases ?? [],
    usage: capabilities.usage ?? path,
    flags: capabilities.flags ?? [],
    globalFlags: supportedGlobalFlagMetadata(path).map(({ flag }) => flag),
    requiresInit: capabilities.requiresInit,
    expectedLatencyClass: capabilities.expectedLatencyClass ?? "fast",
    safeReadOnly: metadata.safeReadOnly ?? false,
    sideEffectClass,
    touchesFunds,
    requiresHumanReview: touchesFunds || path === "init" || path === "upgrade",
    preferredSafeVariant: preferredSafeVariantFor(path),
    prerequisites: metadata.help?.prerequisites ? [metadata.help.prerequisites] : [],
    examples: metadata.help?.examples ?? [],
    jsonFields: metadata.help?.jsonFields ?? null,
    jsonVariants: metadata.help?.jsonVariants ?? [],
    safetyNotes: metadata.help?.safetyNotes ?? [],
    supportsUnsigned: metadata.help?.supportsUnsigned ?? false,
    supportsDryRun: metadata.help?.supportsDryRun ?? false,
    agentWorkflowNotes: metadata.help?.agentWorkflowNotes ?? [],
  };
}

export function buildCommandDescriptor(path: CommandPath): DetailedCommandDescriptor {
  const seed = descriptorSeed(path);
  return {
    command: path,
    description: seed.description,
    aliases: seed.aliases,
    execution: getCommandExecutionMetadata(path),
    usage: seed.usage,
    flags: seed.flags,
    globalFlags: seed.globalFlags,
    requiresInit: seed.requiresInit,
    expectedLatencyClass: seed.expectedLatencyClass,
    safeReadOnly: seed.safeReadOnly,
    sideEffectClass: seed.sideEffectClass,
    touchesFunds: seed.touchesFunds,
    requiresHumanReview: seed.requiresHumanReview,
    preferredSafeVariant: seed.preferredSafeVariant,
    prerequisites: seed.prerequisites,
    examples: seed.examples,
    jsonFields: seed.jsonFields,
    jsonVariants: seed.jsonVariants,
    safetyNotes: seed.safetyNotes,
    supportsUnsigned: seed.supportsUnsigned,
    supportsDryRun: seed.supportsDryRun,
    agentWorkflowNotes: seed.agentWorkflowNotes,
  };
}

export function resolveCommandPath(query: string | string[]): CommandPath | null {
  const normalized = Array.isArray(query)
    ? query.join(" ").trim().replace(/\s+/g, " ")
    : query.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if ((COMMAND_PATHS as string[]).includes(normalized)) {
    return normalized as CommandPath;
  }

  const aliasMatch = COMMAND_PATHS.find((path) =>
    (COMMAND_METADATA[path].aliases ?? []).includes(normalized)
  );
  return aliasMatch ?? null;
}

export function listCommandPaths(): CommandPath[] {
  return [...COMMAND_PATHS];
}

export function getCommandMetadata(path: CommandPath): CommandMetadata {
  return COMMAND_METADATA[path];
}

export function getDocumentedAgentMarkers(): string[] {
  return COMMAND_PATHS
    .map((path) => COMMAND_METADATA[path].agentsDocMarker)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function buildCapabilitiesPayload(): CapabilitiesPayload {
  return {
    commands: CAPABILITIES_COMMAND_ORDER.map((path) => {
      const metadata = getCommandMetadata(path);
      const seed = descriptorSeed(path);
      return {
        name: metadata.capabilities?.name ?? path,
        description: metadata.description,
        aliases: metadata.aliases,
        usage: seed.usage,
        flags: seed.flags,
        agentFlags: metadata.capabilities?.agentFlags,
        requiresInit: seed.requiresInit,
        expectedLatencyClass: seed.expectedLatencyClass,
      };
    }),
    commandDetails: Object.fromEntries(
      COMMAND_PATHS.map((path) => [path, buildCommandDescriptor(path)])
    ),
    executionRoutes: Object.fromEntries(
      COMMAND_PATHS.map((path) => [path, getCommandExecutionMetadata(path)]),
    ),
    globalFlags: GLOBAL_FLAG_METADATA.map(({ flag, description }) => ({ flag, description })),
    agentWorkflow: AGENT_WORKFLOW,
    agentNotes: AGENT_NOTES,
    schemas: CAPABILITIES_SCHEMAS,
    supportedChains: CHAIN_NAMES.map((name) => ({
      name,
      chainId: CHAINS[name].id,
      testnet: CHAINS[name].isTestnet,
    })),
    protocol: CLI_PROTOCOL_PROFILE,
    runtime: buildRuntimeCompatibilityDescriptor(CLI_PACKAGE_INFO.version),
    safeReadOnlyCommands: COMMAND_PATHS
      .filter((path) => COMMAND_METADATA[path].safeReadOnly)
      .map((path) => path),
    jsonOutputContract:
      "All commands emit { schemaVersion, success, ...payload } on stdout when --json or --agent is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage, error: { code, category, message, hint?, retryable? } }. Exception: --unsigned tx emits a raw transaction array without the envelope.",
    documentation: {
      reference: "docs/reference.md",
      agentGuide: "AGENTS.md",
      changelog: "CHANGELOG.md",
      runtimeUpgrades: "docs/runtime-upgrades.md",
      jsonContract: jsonContractDocRelativePath(),
    },
  };
}
