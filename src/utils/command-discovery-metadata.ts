import { CHAINS, CHAIN_NAMES, POA_PORTAL_URL } from "../config/chains.js";
import type {
  CapabilitiesPayload,
  CommandLatencyClass,
  DetailedCommandDescriptor,
} from "../types.js";
import type { CommandHelpConfig } from "./help.js";

export type CommandPath =
  | "init"
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
        "privacy-pools init --mnemonic \"word ...\" --private-key 0x...",
        "privacy-pools init --mnemonic-file ./my-mnemonic.txt --private-key-file ./my-key.txt",
        "cat phrase.txt | privacy-pools init --mnemonic-stdin --yes --default-chain mainnet",
      ],
      jsonFields:
        "{ defaultChain, signerKeySet, recoveryPhraseRedacted? | recoveryPhrase?, warning?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
      safetyNotes: [
        "The recovery phrase and signer key are independent secrets: the phrase controls deposit privacy, the key pays gas. Neither is derived from the other.",
        "Imported recovery phrases automatically recover older Pool Accounts during sync.",
      ],
      agentWorkflowNotes: [
        "When generating a new recovery phrase in machine mode, pass --show-mnemonic and capture it immediately.",
        "When importing an existing recovery phrase, nextActions points to accounts --agent --all-chains so restored Pool Accounts are discovered across mainnets and testnets.",
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
  flow: {
    description: "Run the easy-path deposit-to-withdraw workflow",
    help: {
      overview: [
        "Adds a persisted easy path on top of the same public deposit, ASP review, and relayed private withdrawal flow used by the website and manual CLI commands.",
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
      prerequisites: "init",
    },
    capabilities: {
      usage: "flow",
      flags: ["start <amount> <asset> --to <address>", "watch [workflowId|latest]", "status [workflowId|latest]", "ragequit [workflowId|latest]"],
      agentFlags: "start <amount> <asset> --to <address> --agent (or: watch/status/ragequit --agent)",
      requiresInit: false,
      expectedLatencyClass: "slow",
    },
    safeReadOnly: true,
  },
  "flow start": {
    description: "Deposit now and save a later private withdrawal workflow",
    help: {
      overview: [
        "This is the compressed happy-path command: it performs the normal public deposit, saves a workflow locally, and targets a later relayed private withdrawal from that same Pool Account to the saved recipient.",
        "With --new-wallet, the CLI generates a dedicated workflow wallet, waits for it to be funded, then continues automatically. ETH flows wait for the full ETH target; ERC20 flows wait for the token amount plus native ETH gas reserve.",
        "The saved workflow always withdraws the full remaining balance from the newly created Pool Account, and it never auto-ragequits.",
      ],
      examples: [
        "privacy-pools flow start 0.1 ETH --to 0xRecipient...",
        "privacy-pools flow start 100 USDC --to 0xRecipient... --chain mainnet",
        "privacy-pools flow start 100 USDC --to 0xRecipient... --new-wallet --export-new-wallet ./flow-wallet.txt",
        "privacy-pools flow start 0.1 ETH --to 0xRecipient... --watch --agent",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"start\", workflowId, phase, walletMode?, walletAddress?, requiredNativeFunding?, requiredTokenFunding?, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId?, poolAccountNumber?, depositTxHash?, depositBlockNumber?, depositExplorerUrl?, committedValue?, aspStatus?, withdrawTxHash?, withdrawBlockNumber?, withdrawExplorerUrl?, ragequitTxHash?, ragequitBlockNumber?, ragequitExplorerUrl?, lastError?, nextActions? }",
      safetyNotes: [
        "The deposit is still public and reviewed by the ASP before private withdrawal is possible.",
        "In machine modes, non-round flow amounts are rejected by default for the same privacy reasons as deposit. Prefer round amounts unless you intentionally accept that tradeoff.",
        "Non-interactive workflow wallets require --export-new-wallet so the generated private key is backed up before the flow starts.",
        "Manual commands remain the advanced/manual path when you need custom control over Pool Account selection, amount, or withdrawal mode.",
      ],
      agentWorkflowNotes: [
        "With --new-wallet, the flow stays attached automatically and waits for funding, deposit, approval, and withdrawal unless you detach with Ctrl-C.",
        "Use --watch to stay attached on configured-wallet workflows; otherwise the workflow is persisted locally and flow watch <workflowId> is the canonical resume path.",
      ],
    },
    capabilities: {
      usage: "flow start <amount> <asset> --to <address>",
      flags: ["--to <address>", "--watch", "--new-wallet", "--export-new-wallet <path>"],
      agentFlags: "--agent --to <address> [--watch] [--new-wallet] [--export-new-wallet <path>]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
  },
  "flow watch": {
    description: "Poll ASP approval and withdraw privately when ready",
    help: {
      overview: [
        "Re-checks a saved workflow using the same protocol realities as the frontend. Workflow phases include awaiting_funding, depositing_publicly, awaiting_asp, approved_ready_to_withdraw, withdrawing, paused_poi_required, paused_declined, and stopped_external.",
        "The saved workflow phase is reported in phase, while the deposit review state remains available separately in aspStatus.",
        "Ctrl-C detaches cleanly. It does not cancel the saved workflow or mutate it beyond any state that was already persisted.",
      ],
      examples: [
        "privacy-pools flow watch",
        "privacy-pools flow watch latest --agent",
        "privacy-pools flow watch 123e4567-e89b-12d3-a456-426614174000",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"watch\", workflowId, phase, walletMode?, walletAddress?, requiredNativeFunding?, requiredTokenFunding?, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId?, poolAccountNumber?, depositTxHash?, depositBlockNumber?, depositExplorerUrl?, committedValue?, aspStatus?, withdrawTxHash?, withdrawBlockNumber?, withdrawExplorerUrl?, ragequitTxHash?, ragequitBlockNumber?, ragequitExplorerUrl?, lastError?, nextActions? }",
      safetyNotes: [
        "Paused states are successful workflow states, not CLI errors. Declined workflows surface flow ragequit as the canonical recovery path, and PoA-required workflows pause until the external Proof of Association step is completed.",
      ],
      agentWorkflowNotes: [
        "New-wallet workflows wait for funding automatically. ERC20 workflows require both the token amount and a native ETH gas reserve in the generated wallet before the public deposit can proceed.",
        "When the saved Pool Account is approved, flow watch performs the relayed private withdrawal automatically using the saved recipient and the full remaining balance of that same Pool Account.",
      ],
    },
    capabilities: {
      usage: "flow watch [workflowId|latest]",
      flags: ["[workflowId|latest]"],
      agentFlags: "--agent [workflowId|latest]",
      requiresInit: true,
      expectedLatencyClass: "slow",
    },
  },
  "flow status": {
    description: "Show the saved easy-path workflow state",
    help: {
      overview: [
        "Reads the persisted workflow snapshot and prints the current saved phase plus the canonical next action.",
      ],
      examples: [
        "privacy-pools flow status",
        "privacy-pools flow status latest --agent",
        "privacy-pools flow status 123e4567-e89b-12d3-a456-426614174000",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"status\", workflowId, phase, walletMode?, walletAddress?, requiredNativeFunding?, requiredTokenFunding?, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId?, poolAccountNumber?, depositTxHash?, depositBlockNumber?, depositExplorerUrl?, committedValue?, aspStatus?, withdrawTxHash?, withdrawBlockNumber?, withdrawExplorerUrl?, ragequitTxHash?, ragequitBlockNumber?, ragequitExplorerUrl?, lastError?, nextActions? }",
    },
    capabilities: {
      usage: "flow status [workflowId|latest]",
      flags: ["[workflowId|latest]"],
      agentFlags: "--agent [workflowId|latest]",
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
        "For workflow wallets, this uses the stored per-workflow private key. For configured-wallet workflows, it must use the original depositor signer that created the saved flow.",
      ],
      examples: [
        "privacy-pools flow ragequit",
        "privacy-pools flow ragequit latest --agent",
        "privacy-pools flow ragequit 123e4567-e89b-12d3-a456-426614174000",
      ],
      prerequisites: "init",
      jsonFields:
        "{ mode: \"flow\", action: \"ragequit\", workflowId, phase, walletMode?, walletAddress?, requiredNativeFunding?, requiredTokenFunding?, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId?, poolAccountNumber?, depositTxHash?, depositBlockNumber?, depositExplorerUrl?, committedValue?, aspStatus?, withdrawTxHash?, withdrawBlockNumber?, withdrawExplorerUrl?, ragequitTxHash?, ragequitBlockNumber?, ragequitExplorerUrl?, lastError?, nextActions? }",
      safetyNotes: [
        "This is a public recovery path. It exits to the original deposit address and does not preserve privacy.",
        "Configured-wallet recovery only works when the current signer still matches the original depositor address saved with the workflow.",
      ],
    },
    capabilities: {
      usage: "flow ragequit [workflowId|latest]",
      flags: ["[workflowId|latest]"],
      agentFlags: "--agent [workflowId|latest]",
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
      agentFlags: "--agent --asset <symbol>",
      requiresInit: false,
      expectedLatencyClass: "medium",
    },
    safeReadOnly: true,

    agentsDocMarker: "#### `stats pool`",
  },
  status: {
    description: "Show configuration and check connection health",
    help: {
      examples: [
        "privacy-pools status",
        "privacy-pools status --check",
        "privacy-pools status --no-check",
        "privacy-pools status --agent --check-rpc",
        "privacy-pools status --chain mainnet --rpc-url https://...",
      ],
      jsonFields:
        "{ configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, recoveryPhraseSet, signerKeySet, signerKeyValid, signerAddress, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned, nextActions?: [{ command, reason, when, args?, options?, runnable? }], aspLive?, rpcLive?, rpcBlockNumber? }",
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
        "{ commands[], commandDetails{}, globalFlags[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], safeReadOnlyCommands[], jsonOutputContract, documentation?: { reference, agentGuide, changelog } }",
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
        "{ command, description, aliases, usage, flags, globalFlags, requiresInit, expectedLatencyClass, safeReadOnly, prerequisites, examples, jsonFields, jsonVariants, safetyNotes, supportsUnsigned, supportsDryRun, agentWorkflowNotes }",
    },
    capabilities: {
      usage: "describe <command...>",
      flags: ["<command...>"],
      agentFlags: "--agent <command...>",
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
        "--unsigned tx: [{ to, data, value, valueHex, chainId }]",
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
        "quote: { mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, extraGas?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
        "--unsigned: { mode, operation, withdrawMode, chain, transactions[], ... }",
        "--unsigned tx: [{ to, data, value, valueHex, chainId }]",
        "--dry-run: { operation, mode, dryRun, amount, asset, chain, recipient, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals, feeBPS?, quoteExpiresAt?, extraGas?, anonymitySet?: { eligible, total, percentage } }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
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
        "{ mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, extraGas?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }",
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
        "--unsigned tx: [{ to, data, value, valueHex, chainId }]",
        "--dry-run: { dryRun, operation, chain, asset, amount, poolAccountNumber, poolAccountId, selectedCommitmentLabel, selectedCommitmentValue, proofPublicSignals }",
      ],
      supportsUnsigned: true,
      supportsDryRun: true,
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
        "Without --chain, accounts aggregates all mainnet chains by default. Use --all-chains to include testnets.",
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

export const COMMAND_PATHS = Object.keys(COMMAND_METADATA) as CommandPath[];

export const CAPABILITIES_COMMAND_ORDER: CommandPath[] = [
  "init",
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
  "history",
  "sync",
  "status",
  "ragequit",
  "guide",
  "completion",
  "capabilities",
];

export const GLOBAL_FLAG_METADATA: GlobalFlagMetadata[] = [
  { flag: "-j, --json", description: "Machine-readable JSON output on stdout" },
  { flag: "--format <format>", description: "Output format: table (default), csv, json" },
  { flag: "-y, --yes", description: "Skip confirmation prompts" },
  { flag: "-c, --chain <name>", description: "Target chain (mainnet, arbitrum, optimism, ...)" },
  { flag: "-r, --rpc-url <url>", description: "Override RPC URL" },
  { flag: "-q, --quiet", description: "Suppress non-essential stderr output" },
  { flag: "-v, --verbose", description: "Enable verbose/debug output" },
  { flag: "--no-banner", description: "Disable ASCII banner output" },
  { flag: "--no-color", description: "Disable colored output (also respects NO_COLOR env var)" },
  { flag: "--agent", description: "Machine-friendly mode (alias for --json --yes --quiet)" },
  { flag: "--timeout <seconds>", description: "Network/transaction timeout in seconds (default: 30)" },
];

const AGENT_WORKFLOW = [
  "1. privacy-pools status --agent",
  "2. privacy-pools init --agent --default-chain <chain> --show-mnemonic",
  "3. privacy-pools pools --agent --chain <chain>",
  "4. privacy-pools flow start <amount> <asset> --to <address> --agent --chain <chain>",
  "5. privacy-pools flow watch [workflowId|latest] --agent",
  "6. privacy-pools flow ragequit [workflowId|latest] --agent  (if the saved workflow is declined)",
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
    "--unsigned builds transaction payloads without signing or submitting. Use --unsigned tx for a raw transaction array (no envelope). Requires init (recovery phrase) for deposit secret generation, but does NOT require a signer key. The 'from' field is null; the signing party fills in their own address.",
  metaFlag:
    "--agent is equivalent to --json --yes --quiet. Use it to suppress all stderr output and skip prompts.",
  statusCheck:
    "Run 'status --agent' before transacting. readyForDeposit/readyForWithdraw/readyForUnsigned are configuration capability flags; they confirm the wallet is set up, NOT that withdrawable funds exist. Check 'accounts --agent --chain <chain>' to verify fund availability before withdrawing on a specific chain. Use bare 'accounts --agent' only for the default multi-chain mainnet dashboard.",
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
      "{ schemaVersion, success, mode, operation, chain, transactions: [{ to, data, value, ... }], ... }",
    txFormat:
      "[{ to, data, value, valueHex, chainId }]: raw array, no envelope wrapper. Intended for direct piping to signing tools.",
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
};

function descriptorSeed(path: CommandPath): CommandDescriptorSeed {
  const metadata = getCommandMetadata(path);
  const capabilities = metadata.capabilities;
  if (!capabilities) {
    throw new Error(`Missing capabilities metadata for command path '${path}'.`);
  }

  return {
    description: metadata.description,
    aliases: metadata.aliases ?? [],
    usage: capabilities.usage ?? path,
    flags: capabilities.flags ?? [],
    globalFlags: GLOBAL_FLAG_METADATA.map(({ flag }) => flag),
    requiresInit: capabilities.requiresInit,
    expectedLatencyClass: capabilities.expectedLatencyClass ?? "fast",
    safeReadOnly: metadata.safeReadOnly ?? false,
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
    usage: seed.usage,
    flags: seed.flags,
    globalFlags: seed.globalFlags,
    requiresInit: seed.requiresInit,
    expectedLatencyClass: seed.expectedLatencyClass,
    safeReadOnly: seed.safeReadOnly,
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
    globalFlags: GLOBAL_FLAG_METADATA.map(({ flag, description }) => ({ flag, description })),
    agentWorkflow: AGENT_WORKFLOW,
    agentNotes: AGENT_NOTES,
    schemas: CAPABILITIES_SCHEMAS,
    supportedChains: CHAIN_NAMES.map((name) => ({
      name,
      chainId: CHAINS[name].id,
      testnet: CHAINS[name].isTestnet,
    })),
    safeReadOnlyCommands: COMMAND_PATHS
      .filter((path) => COMMAND_METADATA[path].safeReadOnly)
      .map((path) => path),
    jsonOutputContract:
      "All commands emit { schemaVersion, success, ...payload } on stdout when --json or --agent is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage, error: { code, category, message, hint?, retryable? } }. Exception: --unsigned tx emits a raw transaction array without the envelope.",
    documentation: {
      reference: "docs/reference.md",
      agentGuide: "AGENTS.md",
      changelog: "CHANGELOG.md",
    },
  };
}
