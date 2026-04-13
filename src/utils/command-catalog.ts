import { POA_PORTAL_URL } from "../config/chains.js";
import type {
  CapabilitiesPayload,
  CommandExecutionDescriptor,
  CommandLatencyClass,
} from "../types.js";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "./approval-timing.js";
import type { CommandHelpConfig } from "./help.js";

export type CommandPath =
  | "init"
  | "upgrade"
  | "config"
  | "config list"
  | "config get"
  | "config set"
  | "config path"
  | "config profile list"
  | "config profile create"
  | "config profile active"
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

export type CapabilityEntry = CapabilitiesPayload["commands"][number];

export interface CommandCapabilityMetadata
  extends Omit<CapabilityEntry, "name" | "description" | "aliases"> {
  name?: string;
  /** Flags that agents must supply for unattended execution (no interactive fallback). */
  agentRequiredFlags?: string[];
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

const POOLS_LIST_JSON_FIELDS =
  "{ chain?, allChains?, chains?, search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, decimals, minimumDeposit, vettingFeeBPS, maxRelayFeeBPS, totalInPoolValue, totalInPoolValueUsd, totalDepositsValue, totalDepositsValueUsd, acceptedDepositsValue, acceptedDepositsValueUsd, pendingDepositsValue, pendingDepositsValueUsd, totalDepositsCount, acceptedDepositsCount, pendingDepositsCount, growth24h, pendingGrowth24h }], warnings?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }";

export const COMMAND_CATALOG: Record<CommandPath, CommandMetadata> = {
  init: {
    description: "Initialize wallet and configuration",
    help: {
      overview: [
        "Creates or imports the local Privacy Pools wallet state under ~/.privacy-pools/. The recovery phrase controls deposit privacy and account restoration, while the signer key pays gas and submits transactions; they are intentionally separate secrets.",
        "When you generate a fresh wallet, the CLI uses a 24-word recovery phrase. Imported recovery phrases may be either 12 or 24 words. Back up the recovery phrase immediately: without it, deposited funds cannot be restored.",
        "If you are moving from the website to the CLI, the smoothest restore path is 'privacy-pools init --recovery-phrase-file <downloaded-file>' (or '--recovery-phrase-stdin' when piping the download).",
        "Zero-knowledge proof generation uses bundled checksum-verified circuit artifacts shipped with the CLI package. Set PRIVACY_POOLS_CIRCUITS_DIR only when you intentionally want to override that packaged directory with a pre-provisioned one.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools init",
          "privacy-pools init --yes --default-chain mainnet",
          "privacy-pools init --force --yes --default-chain mainnet",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools init --agent --default-chain mainnet --show-recovery-phrase",
        ]},
        { category: "Import existing keys", commands: [
          "privacy-pools init --recovery-phrase-file ./my-recovery-phrase.txt --private-key-file ./my-key.txt",
          "cat phrase.txt | privacy-pools init --recovery-phrase-stdin --yes --default-chain mainnet",
          "printf '%s\\n' 0x... | privacy-pools init --recovery-phrase-file ./my-recovery-phrase.txt --private-key-stdin --yes --default-chain mainnet",
        ]},
      ],
      jsonFields:
        "{ defaultChain, signerKeySet, recoveryPhraseRedacted? | recoveryPhrase?, warning?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      safetyNotes: [
        "The recovery phrase and signer key are independent secrets: the phrase controls deposit privacy, the key pays gas. Neither is derived from the other.",
        "Newly generated recovery phrases use 24 words for stronger security. Imported recovery phrases may still be 12 or 24 words.",
        "Legacy pre-upgrade accounts may need website migration or website-based recovery before the CLI can safely restore them.",
      ],
      agentWorkflowNotes: [
        "When generating a new recovery phrase in machine mode, pass --show-recovery-phrase and capture it immediately.",
        "When importing an existing recovery phrase, nextActions points to migrate status --agent --all-chains first to check for existing deposits across all chains before transacting.",
      ],
      seeAlso: ["status", "guide", "flow start"],
    },
    capabilities: {
      flags: [
        "--recovery-phrase <phrase>",
        "--recovery-phrase-file <path>",
        "--recovery-phrase-stdin",
        "--private-key <key>",
        "--private-key-file <path>",
        "--private-key-stdin",
        "--default-chain <chain>",
        "--force",
        "--show-recovery-phrase",
      ],
      agentFlags: "--agent --default-chain <chain> --show-recovery-phrase",
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
        "Automatic upgrade is supported only for recognized global npm installs. Source checkouts, non-npm global installs, local project installs, npx-style ephemeral runs, CI, and other ambiguous contexts never mutate; the CLI returns manual guidance plus an exact follow-up npm command.",
        "Machine modes (--json / --agent) stay check-only unless --yes is also present.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools upgrade --check",
          "privacy-pools upgrade",
          "privacy-pools upgrade --yes",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools upgrade --agent --check",
          "privacy-pools upgrade --agent --yes",
        ]},
      ],
      jsonFields:
        "{ mode: \"upgrade\", status, currentVersion, latestVersion, updateAvailable, performed, command|null, installContext: { kind, supportedAutoRun, reason }, installedVersion|null, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      safetyNotes: [
        "Automatic upgrade only runs for recognized global npm installs of privacy-pools-cli.",
        "Source checkouts, non-npm global installs, local project installs, npx-style ephemeral runs, CI, and ambiguous contexts stay read-only and still return an exact npm follow-up command.",
        "A successful upgrade updates the installed CLI on disk but does not hot-reexec the current process. Re-run privacy-pools after it completes.",
      ],
      agentWorkflowNotes: [
        "In machine modes, upgrade is check-only unless --yes is explicitly present.",
        "Treat status = ready as an available update on a supported global npm install, status = manual as an available update requiring manual follow-up, and status = upgraded as a completed install that still requires a fresh CLI invocation.",
      ],
      seeAlso: ["status"],
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
  config: {
    description: "View and manage CLI configuration",
    help: {
      overview: [
        "Inspect or modify the local CLI configuration without re-running init.",
        "Subcommands: list (show all settings), get <key> (read one key), set <key> [value] (write one key), path (print config directory).",
      ],
      examples: [
        "privacy-pools config list",
        "privacy-pools config get default-chain",
        "privacy-pools config set default-chain arbitrum",
        "privacy-pools config path",
      ],
      seeAlso: ["config list", "config get", "config set", "config path", "status", "init"],
    },
    capabilities: {
      usage: "config",
      flags: ["list", "get <key>", "set <key> [value]", "path"],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "config list": {
    description: "List all configuration keys and their current values",
    help: {
      overview: [
        "Shows all configuration keys with their current values. Sensitive keys (recovery-phrase, signer-key) show [set] or [not set] rather than the actual value.",
      ],
      examples: [
        "privacy-pools config list",
        "privacy-pools config list --agent",
      ],
      jsonFields:
        "{ defaultChain, recoveryPhraseSet, signerKeySet, rpcOverrides: { <chainId>: <url> }, configDir }",
      seeAlso: ["config get", "config set", "status"],
    },
    capabilities: {
      usage: "config list",
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "config get": {
    description: "Read a single configuration key",
    help: {
      overview: [
        "Valid keys: default-chain, rpc-override.<chain>, recovery-phrase, signer-key.",
        "Sensitive keys show [set] unless --reveal is passed.",
      ],
      examples: [
        "privacy-pools config get default-chain",
        "privacy-pools config get rpc-override.mainnet",
        "privacy-pools config get recovery-phrase --reveal",
        "privacy-pools config get signer-key --reveal",
      ],
      seeAlso: ["config set", "config list"],
    },
    capabilities: {
      usage: "config get <key>",
      flags: ["--reveal"],
      agentFlags: "--agent [--reveal]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "config set": {
    description: "Write a single configuration key",
    help: {
      overview: [
        "Non-sensitive keys (default-chain, rpc-override.<chain>) accept the value as a positional argument.",
        "Sensitive keys (recovery-phrase, signer-key) require --file <path>, --stdin, or interactive masked input.",
      ],
      examples: [
        "privacy-pools config set default-chain arbitrum",
        "privacy-pools config set rpc-override.mainnet https://my-rpc.example.com",
        "privacy-pools config set recovery-phrase --file ./phrase.txt",
        "cat key.txt | privacy-pools config set signer-key --stdin",
      ],
      safetyNotes: [
        "Sensitive keys are never accepted as positional arguments to prevent shell history leakage.",
        "In non-interactive mode, --file or --stdin is required for sensitive keys.",
      ],
      seeAlso: ["config get", "config list", "init"],
    },
    capabilities: {
      usage: "config set <key> [value]",
      flags: ["--file <path>", "--stdin"],
      agentFlags: "--agent --file <path> | --stdin",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "config path": {
    description: "Print the configuration directory path",
    help: {
      overview: [
        "Prints the resolved configuration home directory. Useful for scripting and diagnostics.",
      ],
      examples: [
        "privacy-pools config path",
        "privacy-pools config path --agent",
      ],
      jsonFields: "{ configDir }",
      seeAlso: ["config list", "status"],
    },
    capabilities: {
      usage: "config path",
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "config profile list": {
    description: "List available profiles",
    help: {
      overview: ["Shows all named profiles and marks the currently active one."],
      examples: [
        "privacy-pools config profile list",
        "privacy-pools config profile list --agent",
      ],
      jsonFields: "{ profiles, active }",
      seeAlso: ["config profile create", "config profile active", "config list"],
    },
    capabilities: {
      usage: "config profile list",
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "config profile create": {
    description: "Create a new named profile",
    help: {
      overview: [
        "Creates a new named profile with its own config directory.",
        "Use --profile <name> on any command to operate under that profile.",
      ],
      examples: [
        "privacy-pools config profile create trading",
        "privacy-pools config profile create ops --agent",
      ],
      jsonFields: "{ profile, created, profileDir }",
      seeAlso: ["config profile list", "init"],
    },
    capabilities: {
      usage: "config profile create <name>",
      agentFlags: "--agent <name>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "config profile active": {
    description: "Show the currently active profile",
    help: {
      overview: ["Displays the active profile name and its config directory path."],
      examples: [
        "privacy-pools config profile active",
        "privacy-pools config profile active --agent",
      ],
      jsonFields: "{ profile, configDir }",
      seeAlso: ["config profile list", "config profile create"],
    },
    capabilities: {
      usage: "config profile active",
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  flow: {
    description: "Guided deposit-to-private-withdrawal workflow",
    help: {
      overview: [
        "Top-level namespace for the persisted easy path on top of the same public deposit, ASP review, and relayed private withdrawal flow used by the website and manual CLI commands.",
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
      seeAlso: ["flow start","flow watch","flow ragequit"],
    },
    capabilities: {
      usage: "flow",
      flags: ["start <amount> <asset> --to <address>", "watch [workflowId|latest]", "status [workflowId|latest]", "ragequit [workflowId|latest]"],
      agentFlags:
        "start <amount> <asset> --to <address> [--privacy-delay <profile>] --agent (or: watch [workflowId|latest] [--privacy-delay <profile>] --agent; status/ragequit --agent)",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "flow start": {
    description: "Deposit now and save a later private withdrawal workflow",
    help: {
      overview: [
        "This is the compressed happy-path command: it performs the normal public deposit, saves a workflow locally, and targets a later relayed private withdrawal (the relayer submits the withdrawal onchain) from that same Pool Account to the saved recipient.",
        "With --new-wallet, the CLI generates a dedicated workflow wallet, waits for it to be funded, then continues automatically. ETH flows wait for the full ETH target; ERC20 flows wait for the token amount plus native ETH gas reserve.",
        "The saved workflow always spends the full remaining balance from the newly created Pool Account. The recipient receives the net amount after relayer fees and any ERC20 extra-gas funding, and the workflow never auto-ragequits.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools flow start 0.1 ETH --to 0xRecipient...",
          "privacy-pools flow start 100 USDC --to 0xRecipient... --chain mainnet",
        ]},
        { category: "With options", commands: [
          "privacy-pools flow start 0.1 ETH --to 0xRecipient... --privacy-delay off",
          "privacy-pools flow start 100 USDC --to 0xRecipient... --new-wallet --export-new-wallet ./flow-wallet.txt",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools flow start 0.1 ETH --to 0xRecipient... --watch --agent",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"start\", workflowId, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, warnings?: [{ code, category: \"privacy\", message }], lastError?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      safetyNotes: [
        "Deposits are always public on-chain. The ASP reviews the deposit before private withdrawal is possible.",
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
      seeAlso: ["flow watch","flow ragequit","pools"],
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
      agentRequiredFlags: ["--to"],
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
  },
  "flow watch": {
    description:
      "Resume a saved flow through funding, approval, privacy delay, and withdrawal",
    help: {
      overview: [
        "Re-checks a saved workflow using the same protocol realities as the frontend. It can resume dedicated-wallet funding, public deposit reconciliation, ASP review, privacy-delay waiting, relayed withdrawal, and pending receipt reconciliation.",
        "Workflow phases include awaiting_funding, depositing_publicly, awaiting_asp, approved_waiting_privacy_delay, approved_ready_to_withdraw, withdrawing, completed, completed_public_recovery, paused_poa_required, paused_declined, and stopped_external.",
        "The saved workflow phase is reported in phase, while the deposit review state from the ASP (the approval service) remains available separately in aspStatus.",
        "When a saved workflow is using balanced or aggressive privacy delay, approval first transitions into approved_waiting_privacy_delay until the persisted randomized hold expires.",
        "Ctrl-C detaches cleanly. It does not cancel the saved workflow or mutate it beyond any state that was already persisted.",
        "flow watch is intentionally unbounded. Agents that need a wall-clock limit should wrap the command in their own external timeout.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools flow watch",
          "privacy-pools flow watch 123e4567-e89b-12d3-a456-426614174000",
        ]},
        { category: "With options", commands: [
          "privacy-pools flow watch latest --privacy-delay off   # updates the saved privacy-delay policy",
          "privacy-pools flow watch latest --agent",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"watch\", workflowId, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, warnings?: [{ code, category: \"privacy\", message }], lastError?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
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
      seeAlso: ["flow status","flow ragequit"],
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
        "{ mode: \"flow\", action: \"status\", workflowId, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, warnings?: [{ code, category: \"privacy\", message }], lastError?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      seeAlso: ["flow watch","flow ragequit"],
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
        "{ mode: \"flow\", action: \"ragequit\", workflowId, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, lastError?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      safetyNotes: [
        "This is a public recovery path. It exits to the original deposit address and does not preserve privacy.",
        "Configured-wallet recovery only works when the current signer still matches the original depositor address saved with the workflow.",
      ],
      seeAlso: ["flow watch","ragequit","accounts"],
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
      overview: [
        "Lists the public Privacy Pools registry and asset metadata. By default, bare `pools` queries the CLI-supported mainnet chains together; pass --chain to scope a single network or --all-chains to include supported testnets too.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools pools",
          "privacy-pools pools ETH",
          "privacy-pools pools BOLD --chain mainnet",
        ]},
        { category: "Search and sort", commands: [
          "privacy-pools pools --all-chains --sort tvl-desc",
          "privacy-pools pools --search usdc --sort asset-asc",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools pools --agent --chain mainnet",
        ]},
      ],
      jsonFields: POOLS_LIST_JSON_FIELDS,
      jsonVariants: [
        "detail (<asset>): { chain, asset, tokenAddress, pool, scope, ..., myFunds?, myFundsWarning?, recentActivity? }",
        "detail myFunds: { balance, usdValue, poolAccounts, pendingCount, poaRequiredCount, declinedCount, accounts: [{ id, status, aspStatus, value }] }",
      ],
      agentWorkflowNotes: [
        "In pools JSON, 'asset' is the symbol for CLI follow-up commands and 'tokenAddress' is the contract address.",
      ],
      seeAlso: ["deposit","stats","activity"],
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
      overview: [
        "Shows the public onchain event feed across Privacy Pools — deposits and withdrawals from all participants.",
        "For your own private transaction history, use 'history' instead.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools activity",
          "privacy-pools activity --page 2 --limit 20",
          "privacy-pools activity --asset ETH",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools activity --asset USDC --agent --chain mainnet",
        ]},
      ],
      jsonFields:
        "{ mode, chain, chains?, page, perPage, total, totalPages, chainFiltered?, note?, asset?, pool?, scope?, events: [{ type, txHash, explorerUrl, reviewStatus, amountRaw, amountFormatted, poolSymbol, poolAddress, chainId, timestamp }], nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      seeAlso: ["history","stats","pools"],
    },
    capabilities: {
      flags: ["[asset]", "--page <n>", "--limit <n>"],
      agentFlags: "--agent [<asset>] [--page <n>] [--limit <n>]",
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
      seeAlso: ["pools","activity"],
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
      seeAlso: ["stats pool","pools"],
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
      seeAlso: ["stats global","pools","activity"],
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
        "When a chain is selected, status runs both RPC and ASP health checks by default. Use --check to force both, --no-check to disable both, or --check-rpc / --check-asp to run only one check.",
        "When status falls back to recommendedMode = read-only because RPC health is degraded, nextActions stays on public discovery and avoids account-state guidance until connectivity is restored.",
        "When only the ASP is degraded but RPC is healthy, status still keeps nextActions on public discovery, while warning that public recovery remains available through ragequit or flow ragequit if the operator already knows the affected account or workflow.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools status",
          "privacy-pools status --check",
          "privacy-pools status --no-check",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools status --agent --check-rpc",
          "privacy-pools status --chain mainnet --rpc-url https://...",
        ]},
      ],
      jsonFields:
        "{ configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, recoveryPhraseSet, signerKeySet, signerKeyValid, signerAddress, signerBalance?, signerBalanceDecimals?, signerBalanceSymbol?, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned, recommendedMode, blockingIssues?, warnings?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }], aspLive?, rpcLive?, rpcBlockNumber? }",
      seeAlso: ["init","sync","upgrade"],
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
        "{ commands[], commandDetails{}, executionRoutes{}, globalFlags[], exitCodes[], envVars[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], protocol{}, runtime{}, safeReadOnlyCommands[], jsonOutputContract, documentation?: { reference, agentGuide, changelog, runtimeUpgrades, jsonContract } }",
      seeAlso: ["describe", "guide"],
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
      overview: [
        "Use spaced command paths such as `withdraw quote` or `stats global`. The JSON output is the runtime contract for agents and includes prerequisites, flags, risk metadata, and JSON field notes.",
      ],
      examples: [
        "privacy-pools describe withdraw",
        "privacy-pools describe withdraw quote --agent",
        "privacy-pools describe stats global --agent",
      ],
      jsonFields:
        "{ command, description, aliases, usage, flags, globalFlags, requiresInit, expectedLatencyClass, safeReadOnly, sideEffectClass, touchesFunds, requiresHumanReview, preferredSafeVariant?, prerequisites, examples, jsonFields, jsonVariants, safetyNotes, supportsUnsigned, supportsDryRun, agentWorkflowNotes }",
      seeAlso: ["capabilities","guide"],
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
      seeAlso: ["init","status"],
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
    description: "Deposit funds into a Privacy Pool",
    help: {
      overview: [
        "Builds the deposit transaction and submits it onchain. After install, the CLI uses bundled checksum-verified circuit artifacts for the local commitment precomputation path, so there is no runtime download step when proofs are needed.",
        "Most proof-generation steps complete in roughly 10-30s once the packaged artifacts are verified locally.",
        "In machine-oriented modes, non-round deposit amounts are rejected by default because they can fingerprint the deposit. Prefer round amounts unless you intentionally accept that privacy trade-off.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools deposit 0.1 ETH",
          "privacy-pools deposit 100 USDC",
        ]},
        { category: "With options", commands: [
          "privacy-pools deposit 0.1 --asset ETH --chain mainnet",
          "privacy-pools deposit 0.1 ETH --dry-run",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools deposit 0.05 ETH --agent",
          "privacy-pools deposit 0.1 ETH --unsigned",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ operation, txHash, amount, committedValue, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber, explorerUrl, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, precommitment, transactions[] }",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, precommitment, balanceSufficient }",
      ],
      safetyNotes: [
        `Deposits are reviewed by the ASP before approval. ${DEPOSIT_APPROVAL_TIMELINE_COPY}`,
        "A vetting fee is deducted from the deposit amount by the pool's ASP.",
        `Only approved deposits can use withdraw, whether relayed or direct. Declined deposits can be recovered publicly via ragequit. Deposits that require Proof of Association (PoA) must complete the PoA flow at ${POA_PORTAL_URL} before they can withdraw privately.`,
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        `Poll accounts --chain <chain> --pending-only while the Pool Account remains pending; when it disappears from pending results, re-run accounts --chain <chain> to confirm whether aspStatus became approved, declined, or requires Proof of Association. Withdraw only after approval; ragequit if declined; complete Proof of Association at ${POA_PORTAL_URL} first if needed. Always preserve the same --chain scope for both polling and confirmation.`,
        "If the deposit transaction was submitted but confirmation timed out or the CLI was interrupted afterward, run sync --chain <chain> before retrying so local state can detect the onchain deposit.",
      ],
      seeAlso: ["accounts","withdraw","pools"],
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
    description: "Privately withdraw funds via relayer",
    help: {
      overview: [
        "Relayed withdrawal is the default because it preserves privacy and follows the website-style happy path. Direct withdrawal is still available, but it links the deposit and withdrawal onchain and should be treated as an explicit privacy trade-off.",
        `Pool Accounts marked poa_required cannot withdraw privately until Proof of Association is completed at ${POA_PORTAL_URL}.`,
        "Like deposits, machine-oriented modes reject non-round amounts by default because unusual amounts can fingerprint the withdrawal. Opt out only when you intentionally accept that trade-off.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools withdraw 0.05 ETH --to 0xRecipient...",
          "privacy-pools withdraw 0.05 ETH --to 0xRecipient... --pool-account PA-2",
        ]},
        { category: "Amount variants", commands: [
          "privacy-pools withdraw --all ETH --to 0xRecipient...",
          "privacy-pools withdraw 50% ETH --to 0xRecipient...",
        ]},
        { category: "With options", commands: [
          "privacy-pools withdraw 0.1 ETH --to 0xRecipient... --dry-run",
          "privacy-pools withdraw 0.05 ETH --to 0xRecipient... --chain mainnet",
        ]},
        { category: "Quote", commands: [
          "privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...",
        ]},
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Always prefer relayed withdrawals (the default). Direct withdrawals (--direct) are NOT privacy-preserving: they publicly link your deposit address and withdrawal address onchain. Only use --direct if you understand and accept the privacy trade-off.",
        "ASP approval is required for both relayed and direct withdrawals. Declined deposits can be recovered publicly via ragequit to the original deposit address.",
        "Relayed withdrawals must also respect the relayer minimum. If a withdrawal would leave a positive remainder below that minimum, the CLI warns so you can withdraw less, use --all/100%, or choose a public recovery path later.",
      ],
      jsonFields:
        "{ operation, mode, txHash, blockNumber, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS, extraGas?, remainingBalance, anonymitySet?: { eligible, total, percentage }, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      jsonVariants: [
        "direct: same fields but mode: \"direct\", feeBPS: null, no extraGas, and human output explains the onchain link between deposit and withdrawal.",
        "quote: { mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, relayTxCost, extraGas?, extraGasFundAmount?, extraGasTxCost?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
        "--unsigned: { mode, operation, withdrawMode, chain, transactions[], ... }",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { operation, mode, dryRun, amount, asset, chain, recipient, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, feeBPS?, quoteExpiresAt?, extraGas?, anonymitySet?: { eligible, total, percentage } }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "If the CLI is interrupted after proof generation but before submission completes, re-run withdraw to generate a fresh proof and re-evaluate the current account state.",
        "If a direct or relayed withdrawal transaction was submitted but confirmation timed out, run sync --chain <chain> before retrying so local state can detect the onchain result.",
      ],
      seeAlso: ["accounts","withdraw quote","ragequit"],
    },
    capabilities: {
      usage: "withdraw [amount] [asset] --to <address>",
      flags: [
        "--asset <symbol|address>",
        "--to <address>",
        "--pool-account <PA-#>",
        "--all",
        "--direct",
        "--extra-gas",
        "--no-extra-gas",
        "--unsigned [envelope|tx]",
        "--dry-run",
      ],
      agentFlags: "--agent",
      agentRequiredFlags: ["--to"],
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
        "{ mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, relayTxCost, extraGas?, extraGasFundAmount?, extraGasTxCost?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      agentWorkflowNotes: [
        "Quotes expire quickly; submit the withdrawal promptly after quoting if the fee is acceptable. Check runnable=false on nextActions for template commands that still need required user input.",
        "For agents, prefer `withdraw quote <amount> --asset <symbol|address>` or `withdraw quote <amount> <asset>`. The legacy asset-first positional form also works but is less clear for machine callers.",
      ],
      seeAlso: ["withdraw","accounts"],
    },
    capabilities: {
      usage: "withdraw quote <amount> --asset <symbol|address>",
      flags: ["--asset <symbol|address>", "--to <address>"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "medium",
    },

    agentsDocMarker: "**Withdrawal quote:**",
  },
  ragequit: {
    description: "Publicly recover funds to your original deposit address (self-custody guarantee)",
    aliases: ["exit"],
    help: {
      overview: [
        "Your self-custody guarantee: publicly recovers funds to the original deposit address at any time. Does not preserve privacy. Available for any Pool Account regardless of ASP status — declined, PoA-blocked, pending, or even approved.",
        "Asset lookup still works when live public pool discovery is unavailable because the CLI keeps a built-in onchain-verified registry for supported pools.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools ragequit ETH --pool-account PA-1",
          "privacy-pools ragequit ETH --pool-account PA-1 --chain mainnet",
        ]},
        { category: "Advanced modes", commands: [
          "privacy-pools ragequit ETH --unsigned --pool-account PA-1",
          "privacy-pools ragequit ETH --dry-run --pool-account PA-1",
        ]},
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Ragequit is always available as your self-custody guarantee, but it is public and irreversible and reveals the original deposit address onchain.",
      ],
      jsonFields:
        "{ operation, txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber, explorerUrl, destinationAddress?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, transactions[] }",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, destinationAddress?, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "If the public recovery transaction was submitted but confirmation timed out, re-run ragequit or sync --chain <chain> before retrying so the CLI can detect the onchain result.",
      ],
      seeAlso: ["withdraw","accounts","flow ragequit"],
    },
    capabilities: {
      usage: "ragequit [asset] --pool-account <PA-#>",
      flags: [
        "--asset <symbol|address>",
        "--pool-account <PA-#>",
        "--unsigned [envelope|tx]",
        "--dry-run",
      ],
      agentFlags: "--agent",
      agentRequiredFlags: ["--pool-account"],
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `ragequit`",
  },
  accounts: {
    description: "List your Pool Accounts with balances",
    help: {
      overview: [
        "Shows each Pool Account, its ASP review state, and per-pool aggregate balances. Bare `accounts` is a mainnet dashboard; use --chain for a specific network or --all-chains to include supported testnets.",
        "Compact modes like --summary and --pending-only are intended for agent polling loops so they do not have to parse the full account dataset on every check.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools accounts",
          "privacy-pools accounts --all-chains",
          "privacy-pools accounts --details",
        ]},
        { category: "Compact modes", commands: [
          "privacy-pools accounts --summary",
          "privacy-pools accounts --chain <name> --pending-only",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools accounts --agent",
          "privacy-pools accounts --no-sync --chain mainnet",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, allChains?, chains?, warnings?, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash, explorerUrl, chain?, chainId? }], balances: [{ asset, balance, usdValue, poolAccounts, chain?, chainId? }], pendingCount, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      jsonVariants: [
        "--summary: { chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poaRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
        "--pending-only: { chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      ],
      agentWorkflowNotes: [
        "Without --chain, accounts aggregates all CLI-supported mainnet chains by default. Use --all-chains to include testnets.",
        "Use --summary or --pending-only to reduce JSON size for polling loops.",
        `When a Pool Account disappears from --pending-only results, re-run accounts without --pending-only to confirm whether it was approved, declined, or requires Proof of Association (${POA_PORTAL_URL}) before choosing withdraw or ragequit.`,
      ],
      seeAlso: ["sync","withdraw","ragequit","history"],
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
      seeAlso: ["migrate status","accounts"],
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
      seeAlso: ["accounts","status"],
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
    description: "Show chronological event history (deposits, migrations, withdrawals, ragequits)",
    help: {
      examples: [
        { category: "Basic", commands: [
          "privacy-pools history",
          "privacy-pools history --limit 10",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools history --agent",
          "privacy-pools history --no-sync --chain mainnet",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }] }",
      seeAlso: ["accounts","activity"],
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
      overview: [
        "Most wallet-aware commands already auto-sync with a 2-minute freshness window, so explicit sync is mainly a crash-recovery or reconciliation tool rather than a command you should need on every workflow step.",
      ],
      examples: [
        "privacy-pools sync",
        "privacy-pools sync --asset ETH --agent",
        "privacy-pools sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, syncedPools, availablePoolAccounts, syncedSymbols?, previousAvailablePoolAccounts?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
      agentWorkflowNotes: [
        "Use sync after deposit, withdraw, or ragequit confirmation timeouts before retrying. It rebuilds local account state from onchain events and prevents duplicate recovery attempts against already-confirmed transactions.",
      ],
      seeAlso: ["accounts","status"],
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
    description: "Generate or install shell completion",
    help: {
      overview: [
        "Generates shell-specific completion scripts for the installed CLI. The default mode prints the raw script to stdout so you can inspect or redirect it manually.",
        "Use --install to set up a managed shell-completion block automatically. That mode writes only local shell/profile files and does not touch wallet state, recovery data, circuits, contracts, or funds.",
      ],
      examples: [
        "privacy-pools completion --install",
        "privacy-pools completion --install zsh",
        "privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools",
        "privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools",
        "privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish",
        "privacy-pools completion powershell >> $PROFILE",
      ],
      jsonFields:
        "{ mode, shell, completionScript? | scriptPath?, profilePath?, scriptCreated?, scriptUpdated?, profileCreated?, profileUpdated?, reloadHint? }",
      seeAlso: ["init","guide"],
    },
    capabilities: {
      flags: ["[shell]", "--shell <shell>", "--install"],
      agentFlags: "--agent [shell] [--install]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: false,
  },
};

export const COMMAND_PATHS = Object.keys(COMMAND_CATALOG) as CommandPath[];
