import { POA_PORTAL_URL } from "../config/chains.js";
import type {
  CapabilitiesPayload,
  CommandExecutionDescriptor,
  CommandLatencyClass,
  NextActionWhen,
} from "../types.js";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "./approval-timing.js";
import type { CommandHelpConfig } from "./help.js";
import { ROOT_COMMAND_DESCRIPTIONS } from "./root-command-groups.js";

export type CommandPath =
  | "init"
  | "upgrade"
  | "config"
  | "config list"
  | "config get"
  | "config set"
  | "config unset"
  | "config path"
  | "config profile"
  | "config profile list"
  | "config profile create"
  | "config profile active"
  | "config profile use"
  | "flow"
  | "flow start"
  | "flow watch"
  | "flow status"
  | "flow step"
  | "flow ragequit"
  | "simulate"
  | "simulate deposit"
  | "simulate withdraw"
  | "simulate ragequit"
  | "pools"
  | "activity"
  | "stats"
  | "protocol-stats"
  | "pool-stats"
  | "status"
  | "tx-status"
  | "capabilities"
  | "describe"
  | "guide"
  | "deposit"
  | "withdraw"
  | "recipients"
  | "recipients list"
  | "recipients add"
  | "recipients remove"
  | "recipients clear"
  | "withdraw recipients"
  | "withdraw recipients list"
  | "withdraw recipients add"
  | "withdraw recipients remove"
  | "withdraw recipients clear"
  | "withdraw quote"
  | "ragequit"
  | "broadcast"
  | "accounts"
  | "migrate"
  | "migrate status"
  | "history"
  | "sync"
  | "completion";

export type CommandSurface =
  | "root-command"
  | "subcommand"
  | "alias"
  | "deprecated-compat"
  | "doc-only"
  | "native-local";

export type CapabilityEntry = CapabilitiesPayload["commands"][number];

export interface CommandCapabilityMetadata
  extends Omit<CapabilityEntry, "name" | "description" | "aliases" | "group"> {
  name?: string;
  /** Structured flag names parsed from the agent invocation surface. */
  agentFlagNames?: string[];
  /** Flags that agents must supply for unattended execution (no interactive fallback). */
  agentRequiredFlags?: string[];
}

export interface CommandMetadata {
  description: string;
  surface: CommandSurface;
  aliases?: string[];
  deprecated?: boolean;
  help?: CommandHelpConfig;
  capabilities?: CommandCapabilityMetadata;
  execution?: CommandExecutionDescriptor;
  safeReadOnly?: boolean;
  expectedNextActionWhen?: NextActionWhen[];
  agentsDocMarker?: string;
}

const POOLS_LIST_JSON_FIELDS =
  "{ chain, chainSummaries?: [{ chain, pools, error }], search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, decimals, minimumDeposit, vettingFeeBPS, maxRelayFeeBPS, totalInPoolValue, totalInPoolValueUsd, totalDepositsValue, totalDepositsValueUsd, acceptedDepositsValue, acceptedDepositsValueUsd, pendingDepositsValue, pendingDepositsValueUsd, totalDepositsCount, acceptedDepositsCount, pendingDepositsCount, growth24h, pendingGrowth24h, myPoolAccountsCount? }], warnings?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }";

const FLOW_RUNTIME_EXPECTED_NEXT_ACTION_WHEN: NextActionWhen[] = [
  "flow_resume",
  "flow_public_recovery_required",
  "flow_declined",
  "flow_public_recovery_pending",
  "flow_public_recovery_optional",
  "flow_manual_followup",
];

const FLOW_START_EXPECTED_NEXT_ACTION_WHEN: NextActionWhen[] = [
  "after_dry_run",
  ...FLOW_RUNTIME_EXPECTED_NEXT_ACTION_WHEN,
];

const SIGNING_SOURCE_NOTE =
  "Signing source precedence: PRIVACY_POOLS_PRIVATE_KEY environment variable first, then the saved signer key file, then recovery-derived fallback where the command supports it.";

export const COMMAND_CATALOG: Record<CommandPath, CommandMetadata> = {
  init: {
    description: ROOT_COMMAND_DESCRIPTIONS.init,
    surface: "root-command",
    help: {
      overview: [
        "Guided setup for the local Privacy Pools account under ~/.privacy-pools/. Use it to create a new account, load an existing account from a recovery phrase, or finish setup by adding or replacing the signer key.",
        "The recovery phrase restores this Privacy Pools account. The signer key submits transactions and may come from the same wallet or a separate key.",
        "When you generate a fresh account, the CLI uses a 24-word recovery phrase. Imported recovery phrases may be either 12 or 24 words. Back up the recovery phrase immediately: without it, deposited funds cannot be restored.",
        "Use --dry-run to preview the effective chain, secret sources, overwrite behavior, and write targets without generating a live recovery phrase or changing files.",
        "If you are moving from the website to the CLI, the smoothest load path is 'privacy-pools init --recovery-phrase-file <downloaded-file>' (or '--recovery-phrase-stdin' when piping the download).",
        "Machine-mode account creation fails closed unless you capture the generated recovery phrase with --show-recovery-phrase or --backup-file. Interactive generated setup defaults to a private .txt backup and only asks for word verification when you choose manual copy.",
        "Use --pending in agent-assisted onboarding when a human should run interactive init locally; the agent receives only a handoff plan and no secret material.",
        "Use only one secret stdin source per run: either --recovery-phrase-stdin or --private-key-stdin.",
        "Zero-knowledge proof generation uses bundled checksum-verified circuit artifacts shipped with the CLI package. Set PRIVACY_POOLS_CIRCUITS_DIR only when you intentionally want to override that packaged directory with a pre-provisioned one.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools init",
          "privacy-pools init --dry-run",
          "privacy-pools init --signer-only",
          "privacy-pools init --yes --default-chain mainnet --backup-file ./privacy-pools-recovery.txt",
          "privacy-pools init --force --yes --default-chain mainnet",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools init --agent --default-chain mainnet --show-recovery-phrase",
          "privacy-pools init --agent --default-chain mainnet --backup-file ./privacy-pools-recovery.txt",
          "privacy-pools init --agent --staged --default-chain mainnet --backup-file ./privacy-pools-recovery.txt",
          "privacy-pools init --pending --agent --default-chain mainnet",
        ]},
        { category: "Load existing account", commands: [
          "privacy-pools init --recovery-phrase-file ./my-recovery-phrase.txt --private-key-file ./my-key.txt",
          "cat phrase.txt | privacy-pools init --recovery-phrase-stdin --yes --default-chain mainnet",
          "privacy-pools init --signer-only --private-key-file ./my-key.txt",
          "printf '%s\\n' 0x... | privacy-pools init --recovery-phrase-file ./my-recovery-phrase.txt --private-key-stdin --yes --default-chain mainnet",
        ]},
      ],
      jsonFields:
        "success: { setupMode, readiness, defaultChain, signerKeySet, mnemonicImported, recoveryPhraseRedacted? | recoveryPhrase?, backupFilePath?, restoreDiscovery?: { status, chainsChecked, foundAccountChains? }, warning?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }; --dry-run: { operation: \"init\", dryRun: true, effectiveChain, recoveryPhraseSource, signerKeySource, backupCaptureMode, backupFilePath?, backupFileWouldWrite, overwriteExisting, overwritePromptRequired, writeTargets[] }; --pending: { mode: \"init-pending\", operation: \"init\", status: \"pending_human_action\", effectiveChain, configExists, recoveryPhraseSet, signerKeyFileSet, replacementRequested, secretTransferRequired, humanCommand, agentResumeCommand, rpcUrl?, nextStep, nextActions?: [...] }",
      jsonVariants: [
        "--staged: JSONL stages with mode: \"init-staged\", operation: \"init\", stage: \"preflight\"|\"recovery\"|\"backup\"|\"signer\"|\"chain\"|\"write\"|\"discovery\"|\"complete\"",
        "--pending: single JSON envelope with mode: \"init-pending\" that tells agents which local human command to request and which status command to run after the human completes init",
      ],
      supportsDryRun: true,
      safetyNotes: [
        "The recovery phrase restores this Privacy Pools account. The signer key submits transactions and may come from the same wallet or a separate key.",
        "Newly generated recovery phrases use 24 words for stronger security. Imported recovery phrases may still be 12 or 24 words.",
        "Legacy pre-upgrade accounts may need website migration or website-based recovery before the CLI can safely restore them.",
      ],
      agentWorkflowNotes: [
        "When generating a new recovery phrase in machine mode, pass --show-recovery-phrase or --backup-file so the phrase is captured before init completes.",
        "When loading an existing recovery phrase, inspect restoreDiscovery and nextActions instead of assuming the account is immediately ready to transact.",
      ],
      seeAlso: ["status", "guide", "flow start"],
    },
    capabilities: {
      flags: [
        "--recovery-phrase <phrase>",
        "--recovery-phrase-file <path>",
        "--recovery-phrase-stdin",
        "--backup-file <path>",
        "--private-key <key>",
        "--private-key-file <path>",
        "--private-key-stdin",
        "--signer-only",
        "--default-chain <chain>",
        "--rpc-url <url>",
        "--force",
        "--show-recovery-phrase",
        "--staged",
        "--pending",
        "--dry-run",
      ],
      agentFlags: "--agent [--staged] --default-chain <chain> (--show-recovery-phrase | --backup-file <path>); or --pending --agent --default-chain <chain>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    agentsDocMarker: "#### `init`",
  },
  upgrade: {
    description: ROOT_COMMAND_DESCRIPTIONS.upgrade,
    surface: "root-command",
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
        "{ mode: \"upgrade\", status, currentVersion, latestVersion, updateAvailable, performed, command|null, installContext: { kind, supportedAutoRun, reason }, installedVersion|null, releaseHighlights?: string[], externalGuidance?: { kind, message, command? }, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
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
      flags: ["--check", "--changelog"],
      agentFlags: "--agent [--check] [--yes]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: false,
    agentsDocMarker: "#### `upgrade`",
  },
  config: {
    description: ROOT_COMMAND_DESCRIPTIONS.config,
    surface: "root-command",
    help: {
      overview: [
        "Inspect or modify the local CLI configuration without re-running init.",
        "Subcommands: list (show all settings), get <key> (read one key), set <key> [value] (write one key), unset <key> (clear one key), path (print config directory), profile use <name> (persist the active profile).",
      ],
      examples: [
        "privacy-pools config list",
        "privacy-pools config get default-chain",
        "privacy-pools config set default-chain arbitrum",
        "privacy-pools config unset rpc-override.mainnet",
        "privacy-pools config path",
      ],
      jsonFields:
        "{ mode: \"help\", command: \"config\", subcommands: [\"list\", \"get\", \"set\", \"unset\", \"path\", \"profile\"], help, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] } when no subcommand is provided; otherwise each config subcommand returns its own structured payload.",
      seeAlso: ["config list", "config get", "config set", "config unset", "config path", "status", "init"],
    },
    capabilities: {
      usage: "config",
      flags: ["list", "get <key>", "set <key> [value]", "unset <key>", "path"],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
    agentsDocMarker: "#### `config`",
  },
  "config list": {
    description: "List all configuration keys and their current values",
    surface: "subcommand",
    help: {
      overview: [
        "Shows all configuration keys with their current values. Sensitive keys (recovery-phrase, signer-key) show [set] or [not set] rather than the actual value.",
      ],
      examples: [
        "privacy-pools config list",
        "privacy-pools config list --agent",
      ],
      jsonFields:
        "{ defaultChain, recoveryPhraseSet, signerKeySet, rpcOverrides: { <chainId>: <url> }, configDir, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
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
    surface: "subcommand",
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
      jsonFields:
        "{ key, value?, set, redacted?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
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
    surface: "subcommand",
    help: {
      overview: [
        "Non-sensitive keys (default-chain, rpc-override.<chain>) accept the value as a positional argument.",
        "The recovery phrase can be updated with --file <path>, --stdin, or interactive masked input.",
        "Signer keys are intentionally excluded from config set. Use 'privacy-pools init --signer-only' to add or replace the signer key safely.",
      ],
      examples: [
        "privacy-pools config set default-chain arbitrum",
        "privacy-pools config set rpc-override.mainnet https://my-rpc.example.com",
        "privacy-pools config set recovery-phrase --file ./phrase.txt",
        "privacy-pools init --signer-only --private-key-file ./signer-key.txt",
      ],
      jsonFields:
        "{ key, updated, changed, removed, summary, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      safetyNotes: [
        "Recovery phrases are never accepted as positional arguments to prevent shell history leakage.",
        "Signer keys cannot be changed through config set. Use init --signer-only instead so the CLI keeps that flow safety-checked and explicit.",
      ],
      seeAlso: ["config get", "config list", "config unset", "init"],
    },
    capabilities: {
      usage: "config set <key> [value]",
      flags: ["--file <path>", "--stdin"],
      agentFlags: "--agent --file <path> | --stdin",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "config unset": {
    description: "Clear a single configuration key",
    surface: "subcommand",
    aliases: ["remove"],
    help: {
      overview: [
        "Clears a stored configuration key without editing config.json by hand.",
        "default-chain resets to the implicit mainnet default. rpc-override.<chain> removes that chain override. recovery-phrase and signer-key remove the local secret files.",
      ],
      examples: [
        "privacy-pools config unset rpc-override.mainnet",
        "privacy-pools config unset default-chain",
        "privacy-pools config unset recovery-phrase",
        "privacy-pools config remove signer-key",
      ],
      safetyNotes: [
        "config unset signer-key only removes the local fallback file. If PRIVACY_POOLS_PRIVATE_KEY is set in the environment, unset it there too.",
      ],
      seeAlso: ["config get", "config set", "config list", "init"],
    },
    capabilities: {
      usage: "config unset <key>",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "config path": {
    description: "Print the configuration directory path",
    surface: "subcommand",
    help: {
      overview: [
        "Prints the resolved configuration home directory. Useful for scripting and diagnostics.",
      ],
      examples: [
        "privacy-pools config path",
        "privacy-pools config path --agent",
      ],
      jsonFields:
        "{ configDir, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
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
  "config profile": {
    description: "Manage named profiles",
    surface: "subcommand",
    help: {
      overview: [
        "Namespace for creating, listing, inspecting, and persisting named profiles.",
        "Profiles keep separate wallet identities and config directories under the CLI home.",
      ],
      examples: [
        "privacy-pools config profile list",
        "privacy-pools config profile create trading",
        "privacy-pools config profile use trading",
      ],
      seeAlso: ["config profile list", "config profile create", "config profile active", "config profile use"],
    },
    capabilities: {
      usage: "config profile <command>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "config profile list": {
    description: "List available profiles",
    surface: "subcommand",
    help: {
      overview: ["Shows all named profiles and marks the currently active one."],
      examples: [
        "privacy-pools config profile list",
        "privacy-pools config profile list --agent",
      ],
      jsonFields:
        "{ profiles, active, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
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
    surface: "subcommand",
    help: {
      overview: [
        "Creates a new named profile with its own config directory.",
        "Use --profile <name> on any command to operate under that profile.",
      ],
      examples: [
        "privacy-pools config profile create trading",
        "privacy-pools config profile create ops --agent",
      ],
      jsonFields:
        "{ profile, created, profileDir, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      seeAlso: ["config profile list", "init"],
    },
    capabilities: {
      usage: "config profile create <name>",
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "config profile active": {
    description: "Show the currently active profile",
    surface: "subcommand",
    help: {
      overview: ["Displays the active profile name and its config directory path."],
      examples: [
        "privacy-pools config profile active",
        "privacy-pools config profile active --agent",
      ],
      jsonFields:
        "{ profile, configDir, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
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
  "config profile use": {
    description: "Persist the active profile",
    surface: "subcommand",
    help: {
      overview: [
        "Persists the default profile to use for future commands when --profile is not explicitly passed.",
        "Use 'default' to switch back to the root ~/.privacy-pools directory.",
      ],
      examples: [
        "privacy-pools config profile use trading",
        "privacy-pools config profile use default",
      ],
      jsonFields:
        "{ profile, active, configDir, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      seeAlso: ["config profile list", "config profile active", "init"],
    },
    capabilities: {
      usage: "config profile use <name>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: false,
  },
  flow: {
    description: ROOT_COMMAND_DESCRIPTIONS.flow,
    surface: "root-command",
    help: {
      overview: [
        "Top-level namespace for the persisted easy path on top of the same public deposit, ASP review, and relayed private withdrawal flow used by the website and manual CLI commands.",
        "In an interactive TTY, bare 'privacy-pools flow' opens a picker for start/watch/status/ragequit. Non-interactive calls must choose a flow subcommand explicitly.",
        "`privacyDelayConfigured = false` in flow JSON means a legacy saved workflow was normalized to `off` without an explicitly saved privacy-delay policy.",
        "Manual commands remain unchanged and are still the advanced/manual path when you need custom Pool Account selection, partial amounts, direct withdrawals, unsigned payloads, or dry-runs.",
      ],
      examples: [
        "privacy-pools flow start 0.1 ETH --to 0xRecipient...",
        "privacy-pools flow start 0.1 ETH --to 0xRecipient... --dry-run",
        "privacy-pools flow start 0.1 ETH --to 0xRecipient... --watch",
        "privacy-pools flow start 100 USDC --to 0xRecipient... --new-wallet --export-new-wallet ./flow-wallet.txt",
        "privacy-pools flow watch",
        "privacy-pools flow status latest",
        "privacy-pools flow step latest",
        "privacy-pools flow ragequit latest",
      ],
      prerequisites: "init for start/watch/ragequit; saved workflow for status",
      jsonFields:
        "{ mode: \"flow\", action: \"start\"|\"watch\"|\"status\"|\"step\"|\"ragequit\", workflowId, workflowKind, phase, nextPollAfter|null, walletMode, chain, asset, depositAmount, recipient, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, relayerHost?, quoteRefreshCount?, reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category, message }], nextActions?: [...] }",
      jsonVariants: [
        "flow start --dry-run: { mode: \"flow\", action: \"start\", dryRun: true, chain, asset, depositAmount, recipient, walletMode, privacyDelayProfile, privacyDelayRandom, privacyDelayRangeSeconds, vettingFee, vettingFeeAmount, vettingFeeBPS, estimatedCommittedValue, estimatedCommitted, feesApply, warnings?, nextActions? }",
      ],
      supportsDryRun: true,
      agentWorkflowNotes: [
        "Start with flow start <amount> <asset> --to <address> --agent, then poll with flow status <workflowId|latest> --agent and advance with flow step <workflowId|latest> --agent until the workflow completes or pauses.",
        "If flow status or flow step returns flow_declined or flow_public_recovery_required, flow ragequit <workflowId|latest> --agent is the canonical saved-workflow public recovery path.",
        "If flow status or flow step returns flow_public_recovery_optional, prefer completing the private path unless the operator explicitly chooses public recovery.",
      ],
      seeAlso: ["flow start","flow status","flow step","flow ragequit"],
    },
    capabilities: {
      usage: "flow",
      flags: ["start <amount> <asset> --to <address>", "watch [workflowId|latest]", "status [workflowId|latest]", "step [workflowId|latest]", "ragequit [workflowId|latest]"],
      agentFlags:
        "start <amount> <asset> --to <address> [--privacy-delay <profile>] --agent, then use status/step/ragequit --agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
    expectedNextActionWhen: [...FLOW_START_EXPECTED_NEXT_ACTION_WHEN],
  },
  simulate: {
    description: ROOT_COMMAND_DESCRIPTIONS.simulate,
    surface: "root-command",
    help: {
      overview: [
        "Preview-only namespace for deposit, withdraw, and ragequit. Each simulate subcommand is a thin alias for the matching command with --dry-run forced on.",
        "simulate does not introduce a new output contract. It intentionally preserves the exact dry-run JSON and human output from the underlying command so existing agent dry-run behavior stays stable.",
        "Unlike the fund-moving commands, simulate never accepts --unsigned. Use the original command with --unsigned when you need a signer-facing envelope instead of a dry-run preview.",
      ],
      examples: [
        "privacy-pools simulate deposit 0.1 ETH",
        "privacy-pools simulate withdraw 0.05 ETH --to 0xRecipient...",
        "privacy-pools simulate ragequit ETH --pool-account PA-1",
      ],
      prerequisites: "init for deposit, withdraw, and ragequit previews",
      jsonFields:
        "{ mode: \"help\", command: \"simulate\", subcommands: [\"deposit\", \"withdraw\", \"ragequit\"], help } when no subcommand is provided; otherwise each simulate subcommand returns the exact same payload as the corresponding command's --dry-run variant.",
      safetyNotes: [
        "simulate never signs or submits a transaction.",
        "simulate is intentionally read-only and rejects --unsigned to keep preview and signing workflows distinct.",
      ],
      agentWorkflowNotes: [
        "Treat simulate as a convenience alias for --dry-run, not as a new machine contract. Existing after_dry_run nextActions remain unchanged.",
      ],
      seeAlso: ["simulate deposit", "simulate withdraw", "simulate ragequit"],
    },
    capabilities: {
      usage: "simulate",
      flags: [
        "deposit <amount> [asset]",
        "withdraw [amount] [asset] --to <address>",
        "ragequit [asset] --pool-account <PA-ID | numeric-index>",
      ],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "flow start": {
    description: "Deposit now and save a later private withdrawal workflow",
    surface: "subcommand",
    help: {
      overview: [
        "This is the compressed happy-path command: it performs the normal public deposit, saves a workflow locally, and targets a later relayed private withdrawal (the relayer submits the withdrawal onchain) from that same Pool Account to the saved recipient.",
        "A Pool Account (e.g. PA-1) is your onchain deposit. Withdraw privately via relayer or recover publicly via ragequit.",
        "With --new-wallet, the CLI generates a dedicated workflow wallet for that one flow. In --agent mode, flow start returns an awaiting_funding snapshot so you can fund the wallet and continue with flow status / flow step. Human runs stay attached and wait automatically. ETH flows require the full ETH target; ERC20 flows require the token amount plus native ETH gas reserve.",
        "The saved workflow always spends the full remaining balance from the newly created Pool Account. The recipient receives the net amount after relayer fees and any ERC20 extra-gas funding, and the workflow never auto-ragequits.",
        "Use --stream-json when a runner needs line-delimited progress events while the workflow is created or watched.",
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
          "privacy-pools flow start 0.1 ETH --to 0xRecipient... --agent",
          "privacy-pools flow status latest --agent",
          "privacy-pools flow step latest --agent",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"start\", workflowId, workflowKind, phase, nextPollAfter|null, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, relayerHost?, quoteRefreshCount?, reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category: \"privacy\"|\"recipient\", message }], lastError?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--dry-run: { mode: \"flow\", action: \"start\", dryRun: true, chain, asset, depositAmount, recipient, walletMode, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, vettingFee, vettingFeeAmount, vettingFeeBPS, estimatedCommittedValue, estimatedCommitted, feesApply, warnings?, nextActions? }",
        "--stream-json progress events: { mode: \"flow-progress\", action: \"start\", event: \"stage\", stage, workflowId?, phase? }",
      ],
      safetyNotes: [
        "Deposits are always public onchain. The ASP reviews the deposit before private withdrawal is possible.",
        "If --to is omitted in interactive mode, the CLI prompts for the recipient. When prompts are skipped, --to remains required.",
        "In machine modes, non-round flow amounts are rejected by default. Use a round amount, or pass --allow-non-round-amounts if you intentionally accept that privacy tradeoff.",
        "New workflows default to a balanced post-approval privacy delay before relayed withdrawal. off = withdraw immediately after ASP approval; weakest privacy. balanced = default; 15 to 90 minutes randomized; standard hygiene. strict = 2 to 12 hours randomized; strongest fingerprint resistance.",
        "Vetting fees can turn a round deposit input into a non-round committed balance, so flow start may still emit an advisory amount-pattern warning for the later full-balance auto-withdrawal.",
        "flow start surfaces advisory privacy warnings when the saved workflow is configured to auto-withdraw a full non-round balance, or when timing delay is explicitly disabled.",
        "--export-new-wallet is only valid with --new-wallet.",
        "Non-interactive workflow wallets require --export-new-wallet so the generated private key is backed up before the flow starts.",
        "Dry-run with --new-wallet in non-interactive mode still requires --export-new-wallet to validate the backup path, but it does not write the file.",
        "The generated workflow key is also stored locally under workflow-secrets until the workflow completes or recovers publicly, so --export-new-wallet is a backup copy rather than the only retained secret.",
        "Dedicated workflow wallets may retain leftover asset balance or gas reserve after paused or terminal states, so check them manually before assuming they are empty.",
        "The saved flow spends the entire remaining Pool Account balance, but the recipient receives the net amount after relayer fees and any ERC20 extra-gas funding.",
        "Manual commands remain the advanced/manual path when you need custom control over Pool Account selection, amount, or withdrawal mode.",
        SIGNING_SOURCE_NOTE,
      ],
      agentWorkflowNotes: [
        "With --new-wallet, --agent returns an awaiting_funding snapshot with the dedicated wallet address and required funding amounts instead of running an internal watch loop.",
        "In --agent mode, --watch is rejected. Start the flow, then use flow status and flow step as separate one-shot primitives.",
      ],
      supportsDryRun: true,
      seeAlso: ["flow status","flow step","flow ragequit","pools"],
    },
    capabilities: {
      usage: "flow start <amount> <asset> --to <address>",
      flags: [
        "--to <address>",
        "--privacy-delay <profile>",
        "--dry-run",
        "--watch",
        "--stream-json",
        "--allow-non-round-amounts",
        "--new-wallet",
        "--export-new-wallet <path>",
      ],
      agentFlags:
        "--agent [--privacy-delay <profile>] [--dry-run] [--stream-json] [--allow-non-round-amounts] [--new-wallet] [--export-new-wallet <path>]",
      agentRequiredFlags: ["--to"],
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    expectedNextActionWhen: [...FLOW_START_EXPECTED_NEXT_ACTION_WHEN],
  },
  "flow watch": {
    description:
      "Resume a saved flow through funding, approval, privacy delay, and withdrawal",
    surface: "subcommand",
    help: {
      overview: [
        "Human-only convenience wrapper that loops flow status plus flow step until the saved workflow changes or settles.",
        "It can resume dedicated-wallet funding, public deposit reconciliation, ASP review, privacy-delay waiting, relayed withdrawal, and pending receipt reconciliation using the same saved-workflow state as the one-shot primitives.",
        "Workflow phases include awaiting_funding, depositing_publicly, awaiting_asp, approved_waiting_privacy_delay, approved_ready_to_withdraw, withdrawing, completed, completed_public_recovery, paused_poa_required, paused_declined, and stopped_external.",
        "The saved workflow phase is reported in phase, while the deposit review state from the ASP (the Association Set Provider) remains available separately in aspStatus.",
        "When a saved workflow is using balanced or strict privacy delay, approval first transitions into approved_waiting_privacy_delay until the persisted randomized hold expires.",
        "Ctrl-C detaches cleanly. It does not cancel the saved workflow or mutate it beyond any state that was already persisted.",
        "flow watch is intentionally unbounded and is rejected in --agent mode. Agents should use flow status and flow step externally instead.",
        "With --stream-json, flow watch emits line-delimited JSON phase_change events as the workflow advances, followed by the final snapshot as the last JSON line with isFinal = true.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools flow watch",
          "privacy-pools flow watch 123e4567-e89b-12d3-a456-426614174000",
        ]},
        { category: "With options", commands: [
          "privacy-pools flow watch latest --privacy-delay off   # updates the saved privacy-delay policy",
          "privacy-pools flow watch latest --stream-json",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"watch\", workflowId, workflowKind, phase, nextPollAfter|null, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, relayerHost?, quoteRefreshCount?, reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category: \"privacy\"|\"recipient\", message }], lastError?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--stream-json: { mode: \"flow\", action: \"watch\", event: \"phase_change\", workflowId, previousPhase, phase, nextActions? } lines as the workflow advances, followed by the final snapshot with isFinal: true",
      ],
      safetyNotes: [
        "Paused states are successful workflow states, not CLI errors. Declined workflows surface flow ragequit as the canonical public recovery path, and PoA-required workflows can either resume privately after the external Proof of Association step or recover publicly with flow ragequit.",
        "If the saved full-balance withdrawal falls below the relayer minimum, flow watch surfaces flow ragequit as the required public recovery path because saved flows only support relayed private withdrawals.",
        "Once the public deposit exists, operators can also choose flow ragequit manually instead of waiting, but it is not emitted as the default nextAction while the workflow is still progressing normally. The happy-path canonical resume command remains flow watch.",
        "Passing --privacy-delay on flow watch updates the saved workflow policy. off = withdraw immediately after ASP approval; weakest privacy. balanced = default; 15 to 90 minutes randomized; standard hygiene. strict = 2 to 12 hours randomized; strongest fingerprint resistance.",
        "Switching to off clears any saved hold immediately; switching between balanced and strict resamples from the override time.",
        SIGNING_SOURCE_NOTE,
      ],
      agentWorkflowNotes: [
        "flow watch is not available in --agent mode.",
        "Use flow status to poll and flow step to advance the same saved workflow externally.",
      ],
      seeAlso: ["flow status","flow step","flow ragequit"],
    },
    capabilities: {
      usage: "flow watch [workflowId|latest]",
      flags: ["[workflowId|latest]", "--privacy-delay <profile>", "--stream-json"],
      agentFlags: "not supported in --agent mode",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    expectedNextActionWhen: [...FLOW_RUNTIME_EXPECTED_NEXT_ACTION_WHEN],
  },
  "flow status": {
    description: "Show the saved easy-path workflow state",
    surface: "subcommand",
    help: {
      overview: [
        "Reads the persisted workflow snapshot and returns the current saved phase plus the canonical next action.",
        "flow status is read-only. Pair it with flow step when you want external orchestration instead of the human-only flow watch wrapper.",
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
        "{ mode: \"flow\", action: \"status\", workflowId, workflowKind, phase, nextPollAfter|null, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, relayerHost?, quoteRefreshCount?, reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category: \"privacy\"|\"recipient\", message }], lastError?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      seeAlso: ["flow step","flow watch","flow ragequit"],
    },
    capabilities: {
      usage: "flow status [workflowId|latest]",
      flags: ["[workflowId|latest]"],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
    expectedNextActionWhen: [...FLOW_RUNTIME_EXPECTED_NEXT_ACTION_WHEN],
  },
  "flow step": {
    description: "Advance a saved workflow by at most one unit of work",
    surface: "subcommand",
    help: {
      overview: [
        "Runs one saved-workflow advancement attempt without keeping an internal watch loop alive.",
        "Use flow step together with flow status in --agent mode: status polls, step advances.",
        "When no action is currently available, flow step returns the current snapshot unchanged instead of waiting.",
        "Use --stream-json when a runner needs line-delimited progress events while one step is attempted.",
      ],
      examples: [
        "privacy-pools flow step latest",
        "privacy-pools flow step latest --agent",
        "privacy-pools flow step latest --stream-json",
        "privacy-pools flow step 123e4567-e89b-12d3-a456-426614174000",
      ],
      prerequisites: "saved workflow (usually created after init)",
      jsonFields:
        "{ mode: \"flow\", action: \"step\", workflowId, workflowKind, phase, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, privacyDelayUntil|null, nextPollAfter|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, relayerHost?, quoteRefreshCount?, reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category: \"privacy\"|\"recipient\", message }], lastError?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--stream-json progress events: { mode: \"flow-progress\", action: \"step\", event: \"stage\", stage, workflowId?, phase? }",
      ],
      seeAlso: ["flow status", "flow watch", "flow ragequit"],
    },
    capabilities: {
      usage: "flow step [workflowId|latest]",
      flags: ["[workflowId|latest]", "--stream-json"],
      agentFlags: "--agent [--stream-json]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    expectedNextActionWhen: [...FLOW_RUNTIME_EXPECTED_NEXT_ACTION_WHEN],
    agentsDocMarker: "#### `flow step`",
  },
  "flow ragequit": {
    description: "Recover a saved workflow publicly via ragequit",
    surface: "subcommand",
    help: {
      overview: [
        "Uses the saved workflow context to perform the public recovery path without changing any manual commands.",
        "Use ragequit when the ASP declined your deposit, the relayer cannot process the remaining balance below minimum, or you want to publicly recover funds without waiting for approval.",
        "Once the public deposit exists, flow ragequit remains available as an optional public recovery path until the workflow reaches a terminal state. Declined flows use it as the canonical recovery path.",
        "If a saved full-balance workflow can no longer satisfy the relayer minimum, flow ragequit becomes the required recovery path because the saved flow only supports relayed private withdrawal.",
        "For workflow wallets, this uses the stored per-workflow private key. For configured-wallet workflows, it must use the original depositor signer that created the saved flow.",
        "Use --stream-json when a runner needs line-delimited progress events while the public recovery is attempted.",
      ],
      examples: [
        "privacy-pools flow ragequit",
        "privacy-pools flow ragequit latest --agent",
        "privacy-pools flow ragequit latest --stream-json",
        "privacy-pools flow ragequit 123e4567-e89b-12d3-a456-426614174000",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"ragequit\", workflowId, workflowKind, phase, nextPollAfter|null, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, privacyDelayUntil|null, withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category, message }], lastError?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--stream-json progress events: { mode: \"flow-progress\", action: \"ragequit\", event: \"stage\", stage, workflowId?, phase? }",
      ],
      safetyNotes: [
        "This is a public recovery path. It exits to the original deposit address and does not preserve privacy.",
        "Configured-wallet recovery only works when the current signer still matches the original depositor address saved with the workflow.",
        SIGNING_SOURCE_NOTE,
      ],
      seeAlso: ["flow watch","ragequit","accounts"],
    },
    capabilities: {
      usage: "flow ragequit [workflowId|latest]",
      flags: ["[workflowId|latest]", "--confirm-ragequit", "--stream-json"],
      agentFlags: "--agent [--confirm-ragequit] [--stream-json]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    expectedNextActionWhen: [
      "flow_public_recovery_pending",
      "after_ragequit",
    ],
  },
  pools: {
    description: ROOT_COMMAND_DESCRIPTIONS.pools,
    surface: "root-command",
    help: {
      overview: [
        "Lists the public Privacy Pools registry and asset metadata. By default, bare `pools` queries the CLI-supported mainnet chains together; pass --chain to scope a single network or --include-testnets to include supported testnets.",
        "Aggregate registry-backed value, count, and growth fields may be null when upstream data is unavailable for a specific pool or chain.",
        "Deprecated or wind-down pool badges are only shown when the upstream registry exposes an explicit lifecycle status. Current CLI-supported sources do not expose a canonical status signal, so the pools output intentionally leaves lifecycle badges unchanged for now.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools pools",
          "privacy-pools pools ETH",
          "privacy-pools pools BOLD --chain mainnet",
        ]},
        { category: "Search and sort", commands: [
          "privacy-pools pools --include-testnets --sort tvl-desc",
          "privacy-pools pools --search usdc --sort asset-asc",
          "privacy-pools pools --limit 10",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools pools --agent --chain mainnet",
        ]},
      ],
      jsonFields: POOLS_LIST_JSON_FIELDS,
      jsonVariants: [
        "detail (<asset>): { chain, asset, tokenAddress, pool, scope, ..., myFunds?, myFundsWarning?, recentActivity?, recentActivityUnavailable? }",
        "detail myFunds: { balance, usdValue, poolAccounts, pendingCount, poaRequiredCount, declinedCount, accounts: [{ id, status, aspStatus, value }] }",
      ],
      agentWorkflowNotes: [
        "In pools JSON, 'asset' is the symbol for CLI follow-up commands and 'tokenAddress' is the contract address.",
        "Registry-backed aggregate fields may be null when upstream data is unavailable for that pool/chain: totalInPoolValue*, totalDeposits*, acceptedDeposits*, pendingDeposits*, *Count, growth24h, and pendingGrowth24h.",
        "Human-readable output is written to stderr; only structured JSON (--json/--agent) writes machine payloads to stdout.",
      ],
      seeAlso: ["deposit","protocol-stats","activity"],
    },
      capabilities: {
      flags: ["--include-testnets", "--search <query>", "--sort <mode>", "--limit <n>"],
      agentFlags: "--agent [--include-testnets] [--search <query>] [--sort <mode>] [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `pools`",
  },
  activity: {
    description: ROOT_COMMAND_DESCRIPTIONS.activity,
    surface: "root-command",
    help: {
      overview: [
        "Shows the public onchain event feed across Privacy Pools, including deposits and withdrawals from all participants.",
        "Bare `activity` stays on CLI-supported mainnet chains by default. Use --include-testnets to aggregate supported mainnet and testnet activity together.",
        "For your own private transaction history, use 'history' instead.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools activity",
          "privacy-pools activity --page 2 --limit 20",
          "privacy-pools activity --include-testnets",
          "privacy-pools activity ETH",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools activity USDC --agent --chain mainnet",
        ]},
      ],
      jsonFields:
        "{ mode, chain, chains?, page, perPage, total, totalEvents, totalPages, chainFiltered?, note?, asset?, pool?, scope?, events: [{ type, txHash, explorerUrl, reviewStatus, amountRaw, amountFormatted, poolSymbol, poolAddress, chainId, timestamp }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      seeAlso: ["history","protocol-stats","pools"],
    },
    capabilities: {
      flags: ["[asset]", "--include-testnets", "--page <n>", "--limit <n>"],
      agentFlags: "--agent [<asset>] [--include-testnets] [--page <n>] [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `activity`",
  },
  stats: {
    description: "Deprecated compatibility alias for protocol-stats and pool-stats",
    surface: "deprecated-compat",
    help: {
      overview: [
        "Deprecated compatibility alias. Use 'protocol-stats' for aggregate network metrics or 'pool-stats <symbol>' for one pool.",
      ],
      examples: [
        "privacy-pools protocol-stats",
        "privacy-pools pool-stats ETH",
        "privacy-pools stats pool ETH  # compatibility alias",
      ],
      seeAlso: ["protocol-stats","pool-stats","pools","activity"],
    },
    capabilities: {
      usage: "stats",
      flags: ["global", "pool <symbol|address>"],
      agentFlags: "compatibility alias; prefer protocol-stats or pool-stats <symbol>",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,
  },
  "protocol-stats": {
    description: ROOT_COMMAND_DESCRIPTIONS["protocol-stats"],
    surface: "root-command",
    aliases: ["stats", "stats global"],
    help: {
      overview: [
        "Always returns aggregate cross-chain statistics. The --chain flag is not supported; use pool-stats <symbol> --chain <chain> for chain-specific data.",
        "--limit is accepted for list-command consistency; protocol-stats remains an aggregate report and does not truncate the allTime/last24h summary objects.",
      ],
      examples: [
        "privacy-pools protocol-stats",
        "privacy-pools protocol-stats --agent --limit 10",
      ],
      jsonFields:
        "{ mode: \"global-stats\", command: \"protocol-stats\", invokedAs?, deprecationWarning?, chain, chains?, cacheTimestamp?, allTime?, last24h?, perChain?: [{ chain, cacheTimestamp, allTime, last24h }] }",
      seeAlso: ["pool-stats","pools"],
    },
    capabilities: {
      usage: "protocol-stats",
      flags: ["--limit <n>"],
      agentFlags: "--agent [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `protocol-stats`",
  },
  "pool-stats": {
    description: ROOT_COMMAND_DESCRIPTIONS["pool-stats"],
    surface: "root-command",
    aliases: ["stats pool"],
    help: {
      overview: [
        "--limit is accepted for list-command consistency; pool-stats remains an aggregate report for one pool.",
      ],
      examples: [
        "privacy-pools pool-stats ETH",
        "privacy-pools pool-stats USDC --agent --chain mainnet --limit 10",
      ],
      jsonFields:
        "{ mode: \"pool-stats\", command: \"pool-stats\", invokedAs?, deprecationWarning?, chain, asset, pool, scope, cacheTimestamp?, allTime?, last24h? }",
      seeAlso: ["protocol-stats","pools","activity"],
    },
    capabilities: {
      usage: "pool-stats <symbol|address>",
      flags: ["<symbol|address>", "--limit <n>"],
      agentFlags: "--agent [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `pool-stats`",
  },
  status: {
    description: ROOT_COMMAND_DESCRIPTIONS.status,
    surface: "root-command",
    help: {
      overview: [
        "A Pool Account (e.g. PA-1) is your onchain deposit. Withdraw privately via relayer or recover publicly via ragequit.",
        "Use recommendedMode plus blockingIssues[]/warnings[] for machine gating, and keep readyForDeposit/readyForWithdraw/readyForUnsigned as configuration capability flags only.",
        "When a chain is selected, status runs both RPC and ASP health checks by default. RPC checks blockchain node reachability. ASP checks 0xBow Association Set Provider connectivity. Use --check all to force both, --check rpc / --check asp to run one check, or --check none / --no-check to disable them.",
        "When status falls back to recommendedMode = read-only because RPC health is degraded, nextActions stays on public discovery and avoids account-state guidance until connectivity is restored.",
        "When only the ASP is degraded but RPC is healthy, status still keeps nextActions on public discovery, while warning that public recovery remains available through ragequit or flow ragequit if the operator already knows the affected account or workflow.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools status",
          "privacy-pools status --check",
          "privacy-pools status --check asp",
          "privacy-pools status --no-check",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools status --agent --check rpc",
          "privacy-pools status --chain mainnet --rpc-url https://...",
        ]},
      ],
      jsonFields:
        "{ mode: \"cli-status\", configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, recoveryPhraseSet, signerKeySet, signerKeyValid, signerAddress, signerBalance?, signerBalanceDecimals?, signerBalanceSymbol?, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned, recommendedMode, blockingIssues?, warnings?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }], aspLive?, rpcLive?, rpcBlockNumber? }",
      seeAlso: ["init","sync","upgrade"],
    },
    capabilities: {
      flags: ["--check [scope]", "--no-check"],
      agentFlags: "--agent [--check <all|rpc|asp|none>] [--no-check]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `status`",
  },
  "tx-status": {
    description: ROOT_COMMAND_DESCRIPTIONS["tx-status"],
    surface: "root-command",
    help: {
      overview: [
        "Read-only polling surface for commands that previously ran with --no-wait.",
        "Use the returned submissionId from deposit, withdraw, ragequit, or broadcast to check confirmation without resubmitting the transaction bundle.",
        "tx-status refreshes onchain receipts for each submitted transaction and returns the latest aggregate status plus follow-up nextActions.",
      ],
      examples: [
        "privacy-pools tx-status 123e4567-e89b-12d3-a456-426614174000",
        "privacy-pools tx-status 123e4567-e89b-12d3-a456-426614174000 --agent",
      ],
      jsonFields:
        "{ operation: \"tx-status\", submissionId, sourceOperation, sourceCommand, chain, asset?, poolAccountId?, poolAccountNumber?, workflowId?, recipient?, broadcastMode?, broadcastSourceOperation?, createdAt, updatedAt, status: \"submitted\"|\"confirmed\"|\"reverted\", reconciliationRequired, localStateSynced, warningCode?, lastError?, estimatedConfirmationSeconds?, pollingRecommendation?: { initialSeconds, maxSeconds, backoffFactor }, transactions: [{ index, description, txHash, explorerUrl, blockNumber, status }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      seeAlso: ["deposit", "withdraw", "ragequit", "broadcast", "flow status"],
    },
    capabilities: {
      flags: [],
      agentFlags: "--agent",
      usage: "tx-status <submissionId>",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
    expectedNextActionWhen: ["after_submit"],
    agentsDocMarker: "#### `tx-status`",
  },
  capabilities: {
    description: ROOT_COMMAND_DESCRIPTIONS.capabilities,
    surface: "root-command",
    help: {
      examples: [
        "privacy-pools capabilities",
        "privacy-pools capabilities --agent",
      ],
      jsonFields:
        "{ commands[{ group, ... }], commandDetails{ ...group... }, executionRoutes{}, globalFlags[], exitCodes[], envVars[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], protocol{}, runtime{}, safeReadOnlyCommands[], jsonOutputContract, documentation?: { reference, agentGuide, changelog, runtimeUpgrades, jsonContract, envelopeSchemas, errorCodes }, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
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
    description: ROOT_COMMAND_DESCRIPTIONS.describe,
    surface: "root-command",
    help: {
      overview: [
        "Machine/runtime introspection surface for agents. Use spaced command paths such as `withdraw quote` or `protocol-stats` to inspect prerequisites, flags, risk metadata, and JSON field notes.",
        "Prefer `guide` for human walkthroughs and conceptual help. Use `describe envelope.<path>` when you want bundled contract fields instead of command metadata.",
        "Single-token schema lookups such as `nextActions` or `shared.nextAction` resolve automatically, while explicit `describe envelope.<path>` stays the clearest form for deeper paths.",
      ],
      examples: [
        "privacy-pools describe withdraw",
        "privacy-pools describe withdraw quote --agent",
        "privacy-pools describe protocol-stats --agent",
        "privacy-pools describe envelope.nextActions --agent",
        "privacy-pools describe envelope.commands.status.successFields --agent",
      ],
      jsonFields:
        "{ mode: \"describe-index\", commands: [{ command, description, group }], envelopeRoots: string[], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] } when no command path is provided; { command, description, group, aliases, usage, flags, globalFlags, requiresInit, expectedLatencyClass, safeReadOnly, expectedNextActionWhen?, sideEffectClass, touchesFunds, requiresHumanReview, preferredSafeVariant?, prerequisites, examples, structuredExamples: [{ description, command, category? }], jsonFields, jsonVariants, safetyNotes, supportsUnsigned, supportsDryRun, agentFlagNames?, agentWorkflowNotes, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] } for describe <command...>; or { path, schema, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] } for describe envelope.<path>",
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
    description: ROOT_COMMAND_DESCRIPTIONS.guide,
    surface: "root-command",
    help: {
      overview: [
        "Human-facing walkthrough surface for concepts, workflows, troubleshooting, and output modes.",
        "Use `describe` when you need machine/runtime contract introspection instead of narrative guidance.",
      ],
      examples: [
        "privacy-pools guide",
        "privacy-pools guide json",
        "privacy-pools help modes",
        "privacy-pools guide --agent",
      ],
      jsonFields:
        "{ mode: \"help\", topic?, topics: [{ name, description }], help, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      seeAlso: ["init","status"],
    },
    capabilities: {
      usage: "guide [topic]",
      flags: ["--topics", "--pager", "--no-pager"],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
    agentsDocMarker: "#### `guide`",
  },
  deposit: {
    description: ROOT_COMMAND_DESCRIPTIONS.deposit,
    surface: "root-command",
    help: {
      overview: [
        "Builds the deposit transaction and submits it onchain. After install, the CLI uses bundled checksum-verified circuit artifacts for the local Pool Account precomputation path, so there is no runtime download step when proofs are needed.",
        "A Pool Account (e.g. PA-1) is your onchain deposit. Withdraw privately via relayer or recover publicly via ragequit.",
        "Most proof-generation steps complete within a few seconds on typical hardware, although cold starts and slower machines can take longer.",
        "In machine-oriented modes, non-round deposit amounts are rejected by default because they can fingerprint the deposit. Prefer round amounts unless you intentionally accept that privacy trade-off.",
        "Each deposit includes a one-time vetting fee reviewed by the Association Set Provider (ASP). The exact amount is shown before you confirm.",
        "The ASP vetting fee is deducted from the public deposit amount, so a round input can still become a non-round committed balance.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools deposit 0.1 ETH",
          "privacy-pools deposit 100 USDC",
        ]},
        { category: "With options", commands: [
          "privacy-pools deposit 0.1 ETH --chain mainnet",
          "privacy-pools deposit 0.1 ETH --dry-run",
          "privacy-pools deposit 100 USDC --max-fee-per-gas 30 --max-priority-fee-per-gas 2",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools deposit 0.05 ETH --agent",
          "privacy-pools deposit 0.1 ETH --unsigned",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ operation, status: \"submitted\"|\"confirmed\", submissionId?, workflowId, txHash, approvalTxHash, amount, committedValue, estimatedCommitted, vettingFeeBPS, vettingFeeAmount, feesApply, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber|null, explorerUrl, reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category, message }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, precommitment, transactions[] } (envelope JSON)",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, precommitment, balanceSufficient, vettingFeeBPS, vettingFeeAmount, estimatedCommitted, feesApply }",
        "--stream-json progress events: { mode: \"deposit-progress\", operation: \"deposit\", event: \"stage\", stage, chain?, asset?, txHash? }",
      ],
      safetyNotes: [
        `Deposits are reviewed by the ASP before approval. ${DEPOSIT_APPROVAL_TIMELINE_COPY}`,
        "An ASP vetting fee is deducted from the deposit amount.",
        "Gas pricing uses the connected RPC's current fee suggestions by default. Use --gas-price for legacy gas pricing, or --max-fee-per-gas plus optional --max-priority-fee-per-gas for EIP-1559 fee caps.",
        `Only approved deposits can use withdraw, whether relayed or direct. Declined deposits can be recovered publicly via ragequit. Deposits that require Proof of Association (PoA) must complete the PoA flow at ${POA_PORTAL_URL} before they can withdraw privately.`,
        "Deposit and simulate deposit amounts are human-readable token amounts, not wei. Asset symbols are normalized case-insensitively.",
        SIGNING_SOURCE_NOTE,
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "With --no-wait, poll tx-status <submissionId> until the deposit transaction confirms, then use flow status <workflowId> or accounts --chain <chain> to follow ASP review.",
        `Poll accounts --chain <chain> --pending-only while the Pool Account remains pending; when it disappears from pending results, re-run accounts --chain <chain> to confirm whether aspStatus became approved, declined, or requires Proof of Association. Withdraw only after approval; ragequit if declined; complete Proof of Association at ${POA_PORTAL_URL} first if needed. Always preserve the same --chain scope for both polling and confirmation.`,
        "If the deposit transaction was submitted but confirmation timed out or the CLI was interrupted afterward, run sync --chain <chain> before retrying so local state can detect the onchain deposit.",
      ],
      seeAlso: ["accounts","withdraw","pools"],
    },
    capabilities: {
      usage: "deposit <amount> [asset]",
      flags: [
        "--unsigned [envelope|tx]",
        "--dry-run",
        "--no-wait",
        "--stream-json",
        "--allow-non-round-amounts",
        "--gas-price <gwei>",
        "--max-fee-per-gas <gwei>",
        "--max-priority-fee-per-gas <gwei>",
      ],
      agentFlags: "--agent [--stream-json]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `deposit`",
  },
  withdraw: {
    description: ROOT_COMMAND_DESCRIPTIONS.withdraw,
    surface: "root-command",
    help: {
      overview: [
        "Relayed withdrawal is the default because it preserves privacy and follows the website-style happy path. Direct withdrawal is still available, but it links the deposit and withdrawal onchain and should be treated as an explicit privacy trade-off.",
        "A Pool Account (e.g. PA-1) is your onchain deposit. Withdraw privately via relayer or recover publicly via ragequit.",
        `Pool Accounts marked poa_required cannot withdraw privately until Proof of Association is completed at ${POA_PORTAL_URL}.`,
        "Withdrawals do not currently block non-round amounts because --all and percentages are common withdrawal paths, but unusual exact amounts can still reduce privacy. Prefer --all, 100%, or round amounts where practical.",
        "In interactive mode, omitting the amount prompts for it after the pool is selected. Relayer quotes are refreshed automatically before proof generation when they are close to expiry.",
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
        "Always prefer relayed withdrawals (the default). Direct withdrawals (--direct) WILL publicly link your deposit and withdrawal addresses onchain. This cannot be undone. Only use --direct if you fully accept this privacy loss.",
        "ASP approval is required for both relayed and direct withdrawals. Declined deposits can be recovered publicly via ragequit to the original deposit address.",
        "Relayed withdrawals must also respect the relayer minimum. If a withdrawal would leave a positive remainder below that minimum, the CLI warns so you can withdraw less, use --all/100%, or choose a public recovery path later.",
        "When prompts are skipped (--agent, --yes, or CI), direct withdrawals still require --confirm-direct-withdraw to explicitly acknowledge the public onchain link.",
        "Gas pricing uses the connected RPC's current fee suggestions for direct withdrawals and public recovery. If network fees are volatile, retry after fees settle or use an RPC/provider that supports reliable fee estimation.",
        "--extra-gas requests native gas tokens alongside ERC20 withdrawals so the recipient can pay gas after receiving funds. ERC20 withdrawals default to this on unless --no-extra-gas is passed; ETH withdrawals ignore it.",
        SIGNING_SOURCE_NOTE,
      ],
      jsonFields:
        "{ operation, status: \"submitted\"|\"confirmed\", submissionId?, mode, txHash, blockNumber|null, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS, relayerHost?, quoteRefreshCount?, extraGas?, remainingBalance, rootMatchedAtProofTime?, reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category, message }], anonymitySet?: { eligible, total, percentage }, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "direct: same fields but mode: \"direct\", feeBPS: null, no extraGas, and human output explains the onchain link between deposit and withdrawal.",
        "quote: { mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, relayTxCost, relayerHost?, quoteRefreshCount?, extraGas?, extraGasFundAmount?, extraGasTxCost?, isTestnet, anonymitySet?: { eligible, total, percentage }, warnings?: [{ code, category, message }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
        "--unsigned: { mode, operation, withdrawMode, chain, transactions[], quoteSummary?: { quotedAt, quoteExpiresAt, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, relayerHost, extraGas } (relayed), ... } (envelope JSON)",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { operation, mode, dryRun, amount, asset, chain, recipient, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, feeBPS?, quoteExpiresAt?, relayerHost?, quoteRefreshCount?, extraGas?, anonymitySet?: { eligible, total, percentage } }",
        "--stream-json progress events: { mode: \"withdraw-progress\", operation: \"withdraw\", event: \"stage\", stage, withdrawMode, chain?, asset?, txHash? }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "With --no-wait, poll tx-status <submissionId> until the withdrawal confirms instead of resubmitting.",
        "If the CLI is interrupted after proof generation but before submission completes, re-run withdraw to generate a fresh proof and re-evaluate the current account state.",
        "If a direct or relayed withdrawal transaction was submitted but confirmation timed out, run sync --chain <chain> before retrying so local state can detect the onchain result.",
      ],
      seeAlso: ["accounts","withdraw quote","ragequit"],
    },
    capabilities: {
      usage: "withdraw [amount] [asset] --to <address>",
      flags: [
        "--to <address>",
        "--pool-account <PA-ID | numeric-index>",
        "--all",
        "--direct",
        "--confirm-direct-withdraw",
        "--accept-all-funds-public",
        "--extra-gas",
        "--no-extra-gas",
        "--unsigned [envelope|tx]",
        "--dry-run",
        "--no-wait",
        "--stream-json",
      ],
      agentFlags: "--agent [--stream-json]",
      agentRequiredFlags: ["--to"],
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `withdraw`",
  },
  "withdraw quote": {
    description: "Request relayer quote and limits without generating a proof",
    surface: "subcommand",
    help: {
      examples: [
        "privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...",
        "privacy-pools withdraw quote ETH 0.1 --to 0xRecipient...",
        "privacy-pools withdraw quote 100 USDC --agent --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, relayTxCost, extraGas?, extraGasFundAmount?, extraGasTxCost?, isTestnet, anonymitySet?: { eligible, total, percentage }, warnings?: [{ code, category, message }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      agentWorkflowNotes: [
        "Quotes expire quickly; submit the withdrawal promptly after quoting if the fee is acceptable. Check runnable=false on nextActions for template commands that still need required user input.",
        "Preferred order is withdraw quote <amount> <asset>; withdraw quote <asset> <amount> remains supported for compatibility.",
      ],
      seeAlso: ["withdraw","accounts"],
    },
    capabilities: {
      usage: "withdraw quote <amount> <asset>",
      flags: ["--to <address>"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "medium",
    },

    agentsDocMarker: "**Withdrawal quote:**",
  },
  recipients: {
    description: ROOT_COMMAND_DESCRIPTIONS.recipients,
    surface: "root-command",
    aliases: ["recents"],
    help: {
      overview: [
        "Shows the local withdrawal recipient history. Successful withdrawals are remembered automatically, and you can add labels manually for repeated recipients.",
      ],
      examples: [
        "privacy-pools recipients",
        "privacy-pools recipients --limit 10",
        "privacy-pools recipients add 0xRecipient... treasury",
        "privacy-pools recipients remove 0xRecipient...",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation, count?, recipients?: [{ address, label, ensName, chain, source, useCount, firstUsedAt, lastUsedAt, updatedAt }], recipient? }",
      safetyNotes: [
        "Recipient history is local advisory metadata only. Always review the final --to address before submitting a withdrawal.",
      ],
      agentWorkflowNotes: [
        "Use this read-only list to offer previously used recipients before prompting for a new address.",
      ],
      seeAlso: ["withdraw", "recipients add", "recipients remove"],
    },
    capabilities: {
      usage: "recipients",
      flags: ["--limit <n>"],
      agentFlags: "--agent [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "recipients list": {
    description: "List remembered withdrawal recipients",
    surface: "subcommand",
    aliases: ["ls"],
    help: {
      examples: [
        "privacy-pools recipients list",
        "privacy-pools recipients list --limit 10",
        "privacy-pools recents",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation: \"list\", count, recipients: [{ address, label, ensName, chain, source, useCount, firstUsedAt, lastUsedAt, updatedAt }] }",
      agentWorkflowNotes: [
        "Use this read-only list to offer previously used recipients before prompting for a new address.",
      ],
      seeAlso: ["withdraw", "recipients"],
    },
    capabilities: {
      usage: "recipients list",
      flags: ["--limit <n>"],
      agentFlags: "--agent [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "recipients add": {
    description: "Add a recipient to the local withdrawal address book",
    surface: "subcommand",
    help: {
      examples: [
        "privacy-pools recipients add 0xRecipient... treasury",
        "privacy-pools recipients add vitalik.eth donations",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation: \"add\", recipient: { address, label, ensName, chain, source, useCount, firstUsedAt, lastUsedAt, updatedAt } }",
      safetyNotes: [
        "Adding a recipient does not authorize a withdrawal. The withdrawal command still performs recipient review before submission.",
      ],
      seeAlso: ["recipients", "recipients remove"],
    },
    capabilities: {
      usage: "recipients add <address-or-ens> [label]",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "recipients remove": {
    description: "Remove a recipient from the local withdrawal address book",
    surface: "subcommand",
    aliases: ["rm"],
    help: {
      examples: [
        "privacy-pools recipients remove 0xRecipient...",
        "privacy-pools recipients rm treasury.eth",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation: \"remove\", recipient: { address, label, ensName, chain, source, useCount, firstUsedAt, lastUsedAt, updatedAt } | null, removed: boolean }",
      seeAlso: ["recipients", "recipients add"],
    },
    capabilities: {
      usage: "recipients remove <address-or-ens>",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "recipients clear": {
    description: "Clear all remembered withdrawal recipients",
    surface: "subcommand",
    help: {
      examples: [
        "privacy-pools recipients clear",
        "privacy-pools recipients clear --yes",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation: \"clear\", removedCount }",
      safetyNotes: [
        "This only clears local recipient metadata. It does not affect accounts, workflows, or onchain state.",
      ],
      seeAlso: ["recipients", "recipients add"],
    },
    capabilities: {
      usage: "recipients clear",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "withdraw recipients": {
    description: "List remembered withdrawal recipients",
    surface: "deprecated-compat",
    aliases: ["recents"],
    deprecated: true,
    help: {
      overview: [
        "Shows the local withdrawal recipient history. Successful withdrawals are remembered automatically, and you can add labels manually for repeated recipients.",
      ],
      examples: [
        "privacy-pools withdraw recipients",
        "privacy-pools withdraw recipients --limit 10",
        "privacy-pools withdraw recipients add 0xRecipient... treasury",
        "privacy-pools withdraw recipients remove 0xRecipient...",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation, count?, recipients?: [{ address, label, ensName, chain, source, useCount, firstUsedAt, lastUsedAt, updatedAt }], recipient? }",
      safetyNotes: [
        "Recipient history is local advisory metadata only. Always review the final --to address before submitting a withdrawal.",
      ],
      agentWorkflowNotes: [
        "Use this read-only list to offer previously used recipients before prompting for a new address.",
      ],
      seeAlso: ["withdraw", "withdraw recipients add", "withdraw recipients remove"],
    },
    capabilities: {
      usage: "withdraw recipients",
      flags: ["--limit <n>"],
      agentFlags: "--agent [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "withdraw recipients list": {
    description: "List remembered withdrawal recipients",
    surface: "deprecated-compat",
    aliases: ["ls"],
    deprecated: true,
    help: {
      examples: [
        "privacy-pools withdraw recipients list",
        "privacy-pools withdraw recipients list --limit 10",
        "privacy-pools withdraw recents",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation: \"list\", count, recipients: [{ address, label, ensName, chain, source, useCount, firstUsedAt, lastUsedAt, updatedAt }] }",
      agentWorkflowNotes: [
        "Use this read-only list to offer previously used recipients before prompting for a new address.",
      ],
      seeAlso: ["withdraw", "withdraw recipients"],
    },
    capabilities: {
      usage: "withdraw recipients list",
      flags: ["--limit <n>"],
      agentFlags: "--agent [--limit <n>]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: true,
  },
  "withdraw recipients add": {
    description: "Add a recipient to the local withdrawal address book",
    surface: "deprecated-compat",
    deprecated: true,
    help: {
      examples: [
        "privacy-pools withdraw recipients add 0xRecipient... treasury",
        "privacy-pools withdraw recipients add vitalik.eth donations",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation: \"add\", recipient: { address, label, ensName, chain, source, useCount, firstUsedAt, lastUsedAt, updatedAt } }",
      safetyNotes: [
        "Adding a recipient does not authorize a withdrawal. The withdrawal command still performs recipient review before submission.",
      ],
      seeAlso: ["withdraw recipients", "withdraw recipients remove"],
    },
    capabilities: {
      usage: "withdraw recipients add <address-or-ens> [label]",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "withdraw recipients remove": {
    description: "Remove a recipient from the local withdrawal address book",
    surface: "deprecated-compat",
    aliases: ["rm"],
    deprecated: true,
    help: {
      examples: [
        "privacy-pools withdraw recipients remove 0xRecipient...",
        "privacy-pools withdraw recipients rm treasury.eth",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation: \"remove\", recipient: { address, label, ensName, chain, source, useCount, firstUsedAt, lastUsedAt, updatedAt } | null, removed: boolean }",
      seeAlso: ["withdraw recipients", "withdraw recipients add"],
    },
    capabilities: {
      usage: "withdraw recipients remove <address-or-ens>",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  "withdraw recipients clear": {
    description: "Clear all remembered withdrawal recipients",
    surface: "deprecated-compat",
    deprecated: true,
    help: {
      examples: [
        "privacy-pools withdraw recipients clear",
        "privacy-pools withdraw recipients clear --yes",
      ],
      jsonFields:
        "{ mode: \"recipient-history\", operation: \"clear\", removedCount }",
      safetyNotes: [
        "This only clears local recipient metadata. It does not affect accounts, workflows, or onchain state.",
      ],
      seeAlso: ["withdraw recipients", "withdraw recipients add"],
    },
    capabilities: {
      usage: "withdraw recipients clear",
      flags: [],
      agentFlags: "--agent",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
  },
  ragequit: {
    description: ROOT_COMMAND_DESCRIPTIONS.ragequit,
    surface: "root-command",
    help: {
      overview: [
        "Your self-custody guarantee: recover funds publicly to your deposit address at any time. This does not provide privacy. Available for any Pool Account regardless of ASP status: declined, PoA-blocked, pending, or approved.",
        "A Pool Account (e.g. PA-1) is your onchain deposit. Withdraw privately via relayer or recover publicly via ragequit.",
        "Asset lookup still works when live public pool discovery is unavailable because the CLI keeps a built-in onchain-verified registry for supported pools.",
        "Use ragequit when the ASP declined your deposit, the relayer cannot process the remaining balance below minimum, or you want to publicly recover funds without waiting for approval.",
        "In interactive mode, standalone ragequit requires typing the exact RAGEQUIT token. When prompts are skipped (--agent, --yes, or CI), use --confirm-ragequit to explicitly acknowledge public recovery to the original deposit address.",
        "Use --stream-json when a runner needs line-delimited progress events while proof generation and public recovery submission run.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools ragequit ETH --pool-account PA-1",
          "privacy-pools ragequit ETH --pool-account PA-1 --chain mainnet",
        ]},
        { category: "Advanced modes", commands: [
          "privacy-pools ragequit ETH --unsigned --pool-account PA-1",
          "privacy-pools ragequit ETH --dry-run --pool-account PA-1",
          "privacy-pools ragequit ETH --pool-account PA-1 --stream-json",
        ]},
      ],
      prerequisites: "init (account state should be synced)",
      safetyNotes: [
        "Ragequit is always available as your self-custody guarantee, but it publicly recovers funds to the original deposit address and does not provide privacy.",
        "Ragequit returns the full Pool Account balance, including any pending portion still under ASP review, to the original deposit address. You will not gain any privacy: this transaction publicly links your deposit to its withdrawal. This cannot be undone.",
        SIGNING_SOURCE_NOTE,
      ],
      jsonFields:
        "{ operation, status: \"submitted\"|\"confirmed\", submissionId?, txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber|null, explorerUrl, destinationAddress?, remainingBalance: \"0\", reconciliationRequired?, localStateSynced?, warningCode?, warnings?: [{ code, category, message }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--unsigned: { mode, operation, chain, asset, amount, transactions[] } (envelope JSON)",
        "--unsigned tx: [{ from, to, data, value, valueHex, chainId, description }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, destinationAddress?, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, remainingBalance: \"0\", nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
        "--stream-json progress events: { mode: \"ragequit-progress\", operation: \"ragequit\", event: \"stage\", stage, chain?, asset?, poolAccountId?, txHash? }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
      agentWorkflowNotes: [
        "With --no-wait, poll tx-status <submissionId> until the public recovery confirms instead of resubmitting.",
        "If the public recovery transaction was submitted but confirmation timed out, re-run ragequit or sync --chain <chain> before retrying so the CLI can detect the onchain result.",
      ],
      seeAlso: ["withdraw","accounts","flow ragequit"],
    },
      capabilities: {
      usage: "ragequit [asset] --pool-account <PA-ID | numeric-index>",
      flags: [
        "--pool-account <PA-ID | numeric-index>",
        "--confirm-ragequit",
        "--unsigned [envelope|tx]",
        "--dry-run",
        "--no-wait",
        "--stream-json",
      ],
      agentFlags: "--agent [--stream-json]",
      agentRequiredFlags: ["--pool-account"],
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `ragequit`",
  },
  "simulate deposit": {
    description: "Preview deposit validation without signing or submitting",
    surface: "subcommand",
    help: {
      overview: [
        "Equivalent to 'deposit --dry-run' with the same validation, JSON payload, and after_dry_run nextActions.",
        "Use it when you want a dedicated preview verb without changing any existing dry-run automation.",
      ],
      examples: [
        "privacy-pools simulate deposit 0.1 ETH",
        "privacy-pools simulate deposit 100 USDC --agent --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, precommitment, balanceSufficient, vettingFeeBPS, vettingFeeAmount, estimatedCommitted, feesApply, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      safetyNotes: [
        "simulate deposit never signs or submits a transaction.",
        "Use 'deposit --unsigned' instead when you need a signer-facing envelope rather than a dry-run preview.",
      ],
      agentWorkflowNotes: [
        "This is a pure alias for deposit --dry-run. Existing agent dry-run parsing and after_dry_run nextActions remain unchanged.",
      ],
      seeAlso: ["deposit", "simulate withdraw"],
    },
    capabilities: {
      usage: "simulate deposit <amount> [asset]",
      flags: ["--allow-non-round-amounts"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,
    expectedNextActionWhen: ["after_dry_run"],
  },
  "simulate withdraw": {
    description: "Preview withdrawal validation without signing or submitting",
    surface: "subcommand",
    help: {
      overview: [
        "Equivalent to 'withdraw --dry-run' with the same validation, JSON payload, and after_dry_run nextActions.",
        "All existing dry-run safety checks remain intact, including relayer quote validation and direct-withdraw privacy warnings.",
      ],
      examples: [
        "privacy-pools simulate withdraw 0.05 ETH --to 0xRecipient...",
        "privacy-pools simulate withdraw --all ETH --to 0xRecipient... --agent --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ operation, mode, dryRun, amount, asset, chain, recipient, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, feeBPS?, quoteExpiresAt?, relayerHost?, quoteRefreshCount?, extraGas?, anonymitySet?: { eligible, total, percentage }, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      safetyNotes: [
        "simulate withdraw never signs or submits a transaction.",
        "Use 'withdraw --unsigned' instead when you need a signer-facing envelope rather than a dry-run preview.",
      ],
      agentWorkflowNotes: [
        "This is a pure alias for withdraw --dry-run. Existing agent dry-run parsing and after_dry_run nextActions remain unchanged.",
      ],
      seeAlso: ["withdraw", "withdraw quote", "simulate ragequit"],
    },
    capabilities: {
      usage: "simulate withdraw [amount] [asset] --to <address>",
      flags: [
        "--to <address>",
        "--pool-account <PA-ID | numeric-index>",
        "--all",
        "--direct",
        "--confirm-direct-withdraw",
        "--accept-all-funds-public",
        "--extra-gas",
        "--no-extra-gas",
      ],
      agentFlags: "--agent",
      agentRequiredFlags: ["--to"],
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,
    expectedNextActionWhen: ["after_dry_run"],
  },
  "simulate ragequit": {
    description: "Preview ragequit validation without signing or submitting",
    surface: "subcommand",
    help: {
      overview: [
        "Equivalent to 'ragequit --dry-run' with the same validation, JSON payload, and after_dry_run nextActions.",
        "Use it to preview the public recovery path without creating a second dry-run contract.",
      ],
      examples: [
        "privacy-pools simulate ragequit ETH --pool-account PA-1",
        "privacy-pools simulate ragequit ETH --pool-account PA-1 --agent --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ dryRun, operation, chain, asset, amount, destinationAddress?, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, remainingBalance: \"0\", nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      safetyNotes: [
        "simulate ragequit never signs or submits a transaction.",
        "Use 'ragequit --unsigned' instead when you need a signer-facing envelope rather than a dry-run preview.",
      ],
      agentWorkflowNotes: [
        "This is a pure alias for ragequit --dry-run. Existing agent dry-run parsing and after_dry_run nextActions remain unchanged.",
      ],
      seeAlso: ["ragequit", "simulate withdraw"],
    },
    capabilities: {
      usage: "simulate ragequit [asset] --pool-account <PA-ID | numeric-index>",
      flags: [
        "--pool-account <PA-ID | numeric-index>",
        "--confirm-ragequit",
      ],
      agentFlags: "--agent",
      agentRequiredFlags: ["--pool-account"],
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,
    expectedNextActionWhen: ["after_dry_run"],
  },
  broadcast: {
    description: ROOT_COMMAND_DESCRIPTIONS.broadcast,
    surface: "root-command",
    help: {
      overview: [
        "Submits a full unsigned envelope after signing has happened elsewhere, or re-submits a relayed withdrawal envelope back through the relayer.",
        "broadcast is intentionally additive: Bankr, custom signers, and other agents can keep using their own submission stack unchanged. This command is an optional first-party inverse for full-envelope workflows.",
        "v1 only accepts the full envelope JSON. Raw transaction arrays from --unsigned tx are rejected so the CLI can validate signed transactions against the original preview before submission.",
        "broadcast never signs, never requires init, and never updates local account files.",
      ],
      examples: [
        "privacy-pools broadcast ./signed-deposit-envelope.json",
        "cat ./signed-ragequit-envelope.json | privacy-pools broadcast - --agent --no-wait",
        "privacy-pools broadcast ./relayed-withdraw-envelope.json --agent --no-wait",
        "privacy-pools broadcast ./signed-envelope.json --validate-only --agent",
      ],
      jsonFields:
        "{ mode: \"broadcast\", broadcastMode: \"onchain\"|\"relayed\", sourceOperation: \"deposit\"|\"withdraw\"|\"ragequit\", chain, validatedOnly?: boolean, submissionId?, submittedBy?, transactions: [{ index, description, txHash: string|null, blockNumber: string|null, explorerUrl: string|null, status: \"submitted\"|\"confirmed\"|\"validated\" }], localStateUpdated: false, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "Partial submission failure: standard error envelope with error.details.submittedTransactions[] and error.details.failedAtIndex so agents do not retry blindly.",
        "--validate-only: same envelope, but validatedOnly: true, transaction status = \"validated\", txHash/blockNumber/explorerUrl = null, and no nextActions because nothing was submitted.",
        "--no-wait: submitted transactions return immediately with submissionId so tx-status can poll confirmation later.",
      ],
      safetyNotes: [
        "broadcast validates each signed transaction against the original preview envelope before the first submission.",
        "Onchain bundles are submitted sequentially and confirmed one-by-one so ERC20 approval + deposit ordering remains safe.",
        "Relayed withdrawals require a non-expired quote and a relayerRequest that exactly matches the preview calldata.",
        "broadcast never signs and never mutates local account state.",
      ],
      agentWorkflowNotes: [
        "Keep using your existing Bankr or custom signer path if you already have one. broadcast is optional and does not change the current --unsigned contract.",
        "For first-party envelope workflows, the canonical sequence is: build with --unsigned, sign outside the CLI, then return with broadcast.",
        "With --no-wait, use tx-status <submissionId> to poll confirmation without re-broadcasting.",
      ],
      seeAlso: ["deposit", "withdraw", "ragequit"],
    },
    capabilities: {
      usage: "broadcast <input>",
      flags: ["--validate-only", "--no-wait"],
      agentFlags: "--agent [--validate-only] [--no-wait]",
      requiresInit: false,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: false,
  },
  accounts: {
    description: ROOT_COMMAND_DESCRIPTIONS.accounts,
    surface: "root-command",
    help: {
      overview: [
        "Shows each Pool Account, its ASP review state, and per-pool aggregate balances. Bare `accounts` is a mainnet dashboard; use --chain for a specific network or --include-testnets to include supported testnets.",
        "Compact modes like --summary and --pending-only are intended for agent polling loops so they do not have to parse the full account dataset on every check.",
        "--pending-only remains supported as shorthand for --status pending in polling loops.",
        "Use --status <status> to filter by approved/pending/poa_required/declined/unknown/spent/exited. Human-only --watch is a 15-second pending poll loop that stops when pending results reach zero or on Ctrl-C.",
      ],
      examples: [
        { category: "Basic", commands: [
          "privacy-pools accounts",
          "privacy-pools accounts --include-testnets",
          "privacy-pools accounts --details",
        ]},
        { category: "Compact modes", commands: [
          "privacy-pools accounts --summary",
          "privacy-pools accounts --chain <name> --pending-only",
          "privacy-pools accounts --chain <name> --status approved",
          "privacy-pools accounts --chain <name> --pending-only --watch",
          "privacy-pools accounts --limit 10",
        ]},
        { category: "Agent / CI", commands: [
          "privacy-pools accounts --agent",
          "privacy-pools accounts --no-sync --chain mainnet",
        ]},
      ],
      prerequisites: "init",
      jsonFields:
        "{ chain, allChains?, chains?, warnings?, lastSyncTime?, syncSkipped, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash, explorerUrl, chain?, chainId? }], balances: [{ asset, balance, usdValue, poolAccounts, chain?, chainId? }], pendingCount, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--summary: { chain, allChains?, chains?, warnings?, lastSyncTime?, syncSkipped, pendingCount, approvedCount, poaRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
        "--pending-only: { chain, allChains?, chains?, warnings?, lastSyncTime?, syncSkipped, accounts, pendingCount, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      ],
      agentWorkflowNotes: [
        "Without --chain, accounts aggregates all CLI-supported mainnet chains by default. Use --include-testnets to include supported testnets.",
        "Use --summary or --pending-only to reduce JSON size for polling loops.",
        `When a Pool Account disappears from --pending-only results, re-run accounts without --pending-only to confirm whether it was approved, declined, or requires Proof of Association (${POA_PORTAL_URL}) before choosing withdraw or ragequit.`,
      ],
      seeAlso: ["sync","withdraw","ragequit","history"],
    },
    capabilities: {
      flags: ["--no-sync", "--refresh", "--include-testnets", "--details", "--summary", "--history", "--page <n>", "--pending-only", "--status <status>", "--watch", "--watch-interval <seconds>", "--limit <n>"],
      agentFlags: "--agent [--limit <n>]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `accounts`",
  },
  migrate: {
    description: ROOT_COMMAND_DESCRIPTIONS.migrate,
    surface: "root-command",
    help: {
      overview: [
        "Read-only command for legacy pre-upgrade accounts on chains currently supported by the CLI. It rebuilds the legacy account view from the installed SDK plus current onchain events, then reports whether the Privacy Pools website migration flow or website-based recovery is needed.",
        "The CLI does not submit legacy migrations. Use the Privacy Pools website for actual migration or website-based recovery.",
      ],
      examples: [
        "privacy-pools migrate status",
        "privacy-pools migrate status --chain mainnet",
        "privacy-pools migrate status --include-testnets --agent",
      ],
      prerequisites: "init",
      seeAlso: ["accounts"],
    },
    capabilities: {
      usage: "migrate",
      flags: ["--include-testnets"],
      agentFlags: "--agent [--include-testnets]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,
  },
  "migrate status": {
    description: ROOT_COMMAND_DESCRIPTIONS.migrate,
    surface: "subcommand",
    help: {
      overview: [
        "Reconstructs the legacy account view without persisting local account state, using the built-in CLI pool registry plus current onchain events for CLI-supported chains, then summarizes whether legacy Pool Accounts still need website migration, appear fully migrated already, or require website-based public recovery instead.",
        "Without --chain, migrate status checks all CLI-supported mainnet chains by default. Use --include-testnets to include supported testnets.",
      ],
      examples: [
        "privacy-pools migrate status",
        "privacy-pools migrate status --chain mainnet",
        "privacy-pools migrate status --include-testnets --agent",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"migration-status\", chain, allChains?, chains?, warnings?, status, requiresMigration, requiresWebsiteRecovery, isFullyMigrated, readinessResolved, submissionSupported: false, requiredChainIds, migratedChainIds, missingChainIds, websiteRecoveryChainIds, unresolvedChainIds, chainReadiness: [{ chain, chainId, status, candidateLegacyCommitments, expectedLegacyCommitments, migratedCommitments, legacyMasterSeedNullifiedCount, hasPostMigrationCommitments, isMigrated, legacySpendableCommitments, upgradedSpendableCommitments, declinedLegacyCommitments, reviewStatusComplete, requiresMigration, requiresWebsiteRecovery, scopes }], externalGuidance?: { kind, message, url }, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
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
      flags: ["--include-testnets"],
      agentFlags: "--agent [--include-testnets]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `migrate status`",
  },
  history: {
    description: ROOT_COMMAND_DESCRIPTIONS.history,
    surface: "root-command",
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
      overview: [
        "Use --no-sync to read cached local history faster. When cached data is returned, the JSON payload includes lastSyncTime and syncSkipped so agents can judge staleness explicitly.",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"private-history\", chain, page, perPage, total, totalPages, lastSyncTime?, syncSkipped, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--no-sync: same fields, plus lastSyncTime? when cached local history was used and syncSkipped = true.",
      ],
      seeAlso: ["accounts","activity"],
    },
    capabilities: {
      flags: ["--no-sync", "--page <n>", "--limit <n>"],
      agentFlags: "--agent",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `history`",
  },
  sync: {
    description: ROOT_COMMAND_DESCRIPTIONS.sync,
    surface: "root-command",
    help: {
      overview: [
        "Most wallet-aware commands already auto-sync with a 2-minute freshness window, so explicit sync is mainly a crash-recovery or reconciliation tool rather than a command you should need on every workflow step.",
        "Bare `privacy-pools sync` re-syncs every discovered pool on the selected chain. Pass an asset symbol to limit the rebuild to one pool.",
        "Use --stream-json for line-delimited progress heartbeats in machine mode. The final line remains the normal sync result envelope and includes isFinal = true.",
      ],
      examples: [
        "privacy-pools sync",
        "privacy-pools sync ETH --agent",
        "privacy-pools sync --chain mainnet",
      ],
      prerequisites: "init",
      jsonFields:
        "{ isFinal: true, chain, syncedPools, availablePoolAccounts, syncedSymbols?, previousAvailablePoolAccounts?, durationMs?, scannedFromBlock?, scannedToBlock?, eventCounts?: { deposits, withdrawals, ragequits, migrations, total }, lastSyncTime?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      jsonVariants: [
        "--stream-json progress events: { mode: \"sync-progress\", chain, event: \"stage\"|\"heartbeat\", stage, elapsedMs? }",
      ],
      agentWorkflowNotes: [
        "Use sync after deposit, withdraw, or ragequit confirmation timeouts before retrying. It rebuilds local account state from onchain events and prevents duplicate recovery attempts against already-confirmed transactions.",
        "Default sync --agent stays as one final JSON envelope. Add --stream-json when your runner needs progress heartbeats during long syncs; the terminal result line includes isFinal = true.",
      ],
      seeAlso: ["accounts","status"],
    },
    capabilities: {
      flags: ["[asset]", "--stream-json"],
      agentFlags: "--agent [asset] [--stream-json]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },

    agentsDocMarker: "#### `sync`",
  },
  completion: {
    description: ROOT_COMMAND_DESCRIPTIONS.completion,
    surface: "root-command",
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
        "{ mode, shell, completionScript? | scriptPath?, profilePath?, scriptCreated?, scriptUpdated?, profileCreated?, profileUpdated?, bootstrapProfilePath?, bootstrapProfileCreated?, bootstrapProfileUpdated?, reloadHint?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
      seeAlso: ["init","guide"],
    },
    capabilities: {
      flags: ["[shell]", "--shell <shell>", "--install"],
      agentFlags: "--agent [shell] [--install]",
      requiresInit: false,
      expectedLatencyClass: "fast",
    },
    safeReadOnly: false,
    agentsDocMarker: "#### `completion`",
  },
};

export const COMMAND_PATHS = Object.keys(COMMAND_CATALOG) as CommandPath[];
