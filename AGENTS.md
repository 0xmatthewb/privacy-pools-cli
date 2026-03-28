# Agent Integration Guide

This document is for AI agents, bots, and programmatic consumers of the Privacy Pools CLI. For human users, see [`README.md`](README.md) or run `privacy-pools guide`.

For flags, configuration, and environment variables, see [`docs/reference.md`](docs/reference.md). For native runtime troubleshooting and fallback controls, see [`docs/runtime-upgrades.md`](docs/runtime-upgrades.md). For release history, see [`CHANGELOG.md`](CHANGELOG.md).

> **Skill files**: For Bankr, Claude Code, and other skill-aware agents, see [`skills/privacy-pools-cli/SKILL.md`](skills/privacy-pools-cli/SKILL.md) and [`skills/privacy-pools-cli/reference.md`](skills/privacy-pools-cli/reference.md).

## Quick Start

```bash
# Install
npm i -g privacy-pools-cli
# or
bun add -g privacy-pools-cli

# Unreleased/source builds
npm i -g github:0xmatthewb/privacy-pools-cli

# Discover capabilities (no wallet needed)
privacy-pools capabilities --agent
privacy-pools describe withdraw quote --agent

# Browse pools (no wallet needed)
privacy-pools pools --agent

# Easy workflow
privacy-pools status --agent
privacy-pools init --agent --default-chain mainnet --show-mnemonic
privacy-pools flow start 0.1 ETH --to 0xRecipient --agent
privacy-pools flow watch latest --agent
privacy-pools flow ragequit latest --agent    # saved-workflow public recovery if declined

# Manual workflow
privacy-pools deposit 0.1 ETH --agent
privacy-pools accounts --agent --chain mainnet --pending-only   # poll while the deposit remains pending; preserve the same --chain on other networks
privacy-pools accounts --agent --chain mainnet                  # once pending disappears, confirm approved vs declined vs poi_required
privacy-pools migrate status --agent --all-chains               # read-only legacy migration or recovery check on CLI-supported chains
privacy-pools withdraw --all ETH --to 0xRecipient --agent
```

## Distribution

The public npm entrypoint is `privacy-pools-cli`. It installs the JS launcher
and, when present, an exact-version optional native shell package for the host:

| Human OS | Native package |
| ---- | ---- |
| macOS (Apple Silicon) | `@0xmatthewb/privacy-pools-cli-native-macos-arm64` |
| macOS (Intel) | `@0xmatthewb/privacy-pools-cli-native-macos-x64` |
| Linux (x64, glibc) | `@0xmatthewb/privacy-pools-cli-native-linux-x64-gnu` |
| Windows (x64, MSVC) | `@0xmatthewb/privacy-pools-cli-native-windows-x64-msvc` |
| Windows (ARM64, MSVC) | `@0xmatthewb/privacy-pools-cli-native-windows-arm64-msvc` |

Node/npm still use `darwin` and `win32` internally in `os` selectors because
those are the official Node platform ids. `darwin` means macOS.

Linux native packaging currently targets x64 glibc hosts. Alpine and other
musl-based environments fall back to the JS launcher automatically instead of
loading an incompatible native package.

## Core Concepts

**Agent mode**: Pass `--agent` to any command. This is equivalent to `--json --yes --quiet`: machine-readable JSON on stdout, no interactive prompts, no banners or progress text.

**Dual output**: Structured JSON always goes to **stdout**. Human-readable command output goes to **stderr**, except built-in help, welcome, and shell completion text, which write to **stdout**. In `--agent` mode, stderr is suppressed.

**JSON envelope**: Every response follows the schema:

```
{ "schemaVersion": "1.6.0", "success": true, ...payload }
{ "schemaVersion": "1.6.0", "success": false, "errorCode": "...", "errorMessage": "...", "error": { ... } }
```

Parse `success` first. On failure, read `errorCode` for programmatic handling and `error.hint` for remediation. Check `error.retryable` before deciding to retry.

Some success payloads also include optional `nextActions[]` workflow guidance in the form `{ command, reason, when, args?, options?, runnable? }`. Treat `nextActions` as the canonical machine follow-up field. When `runnable = false`, the action is a template and needs additional user input before execution.

## Preflight Check

Before running wallet-dependent commands, verify setup:

```bash
privacy-pools status --agent
```

Check `recoveryPhraseSet: true`. Most transaction commands also require `signerKeyValid: true` and `readyForDeposit: true`; if `readyForDeposit: false` because the signer is missing or invalid, set `PRIVACY_POOLS_PRIVATE_KEY` in the agent's environment before running transaction commands.

For machine gating, prefer `recommendedMode`, `blockingIssues[]`, and `warnings[]` over inferring from booleans alone. `readyForDeposit`, `readyForWithdraw`, and `readyForUnsigned` remain configuration capability flags, not fund-availability checks. When `recommendedMode = "read-only"`, status detected degraded RPC or ASP health and agents should stick to non-transactional commands until connectivity is restored.

Exception: `flow start --new-wallet` creates and uses a dedicated per-workflow wallet, so it can begin without a configured global signer key as long as the recovery phrase is present.

## Human + Agent Workflow

When a human delegates CLI operations to an agent:

1. **Human** runs `privacy-pools init` interactively (securely stores recovery phrase and signer key)
2. **Human** sets `PRIVACY_POOLS_PRIVATE_KEY` env var in the agent's environment, unless the agent will use `flow start --new-wallet`
3. **Agent** uses `--agent` flag for all operations
4. **Agent** runs `privacy-pools status --agent` to verify setup before transacting
5. **Human** reviews transaction results

## Global Flags

| Flag | Description |
| ---- | ----------- |
| `--agent` | Machine-friendly mode (alias for `--json --yes --quiet`) |
| `-j, --json` | Machine-readable JSON output on stdout |
| `--format <fmt>` | Output format: `table` (default), `csv`, `json` |
| `-y, --yes` | Skip confirmation prompts |
| `-c, --chain <name>` | Target chain (mainnet, arbitrum, optimism, ...) |
| `-r, --rpc-url <url>` | Override RPC URL |
| `-q, --quiet` | Suppress human-oriented stderr output |
| `-v, --verbose` | Enable verbose/debug output |
| `--no-banner` | Disable ASCII banner output |
| `--no-color` | Disable colored output (also respects `NO_COLOR` env var) |
| `--timeout <seconds>` | Network/transaction timeout in seconds (default: 30) |

## Command Reference

### No Wallet Required

These commands work immediately after install, no `init` or private keys needed.

#### `pools`

List available Privacy Pools. When no `--chain` is specified, defaults to querying all CLI-supported mainnet chains.

```bash
privacy-pools pools --agent
privacy-pools pools --agent --all-chains
privacy-pools pools --agent --search ETH
privacy-pools pools --agent --sort tvl-desc
privacy-pools pools ETH --agent             # detail view for a specific pool
```

JSON payload (single chain): `{ chain?, allChains?, chains?, search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, decimals, minimumDeposit, vettingFeeBPS, maxRelayFeeBPS, totalInPoolValue, totalInPoolValueUsd, totalDepositsValue, totalDepositsValueUsd, acceptedDepositsValue, acceptedDepositsValueUsd, pendingDepositsValue, pendingDepositsValueUsd, totalDepositsCount, acceptedDepositsCount, pendingDepositsCount, growth24h, pendingGrowth24h }], warnings? }`

Default sort is `tvl-desc` (highest pool balance first). Override with `--sort`.

In pools JSON, `asset` is the symbol to use in follow-up CLI commands and `tokenAddress` is the token contract address.

With `--all-chains`, each pool includes a `chain` field and the root includes `allChains: true`, `chains: [{ chain, pools, error }]`, and optional `warnings`.

**Detail view** (`pools <asset>`): Shows pool stats, your funds (if wallet state can be loaded), and recent activity for a single pool. JSON payload: `{ chain, asset, tokenAddress, pool, scope, ..., myFunds?, myFundsWarning?, recentActivity? }`. `myFunds.balance` is total remaining balance across active Pool Accounts in that pool; private withdrawal still requires `status/aspStatus = "approved"`. When `myFunds` is `null`, `myFundsWarning` may explain why wallet state could not be loaded. Supports `--json` and `--chain`. Does not support `--format csv`.

#### `activity`

Public onchain activity feed. When no `--chain` is specified, defaults to querying all CLI-supported mainnet chains.

```bash
privacy-pools activity --agent
privacy-pools activity --agent --asset ETH --limit 20
```

JSON payload (global): `{ mode: "global-activity", chain, chains?, page, perPage, total, totalPages, chainFiltered?, note?, events: [{ type, txHash, explorerUrl, reviewStatus, amountRaw, amountFormatted, poolSymbol, poolAddress, chainId, timestamp }] }`

When querying all CLI-supported mainnet chains (no `--chain`), `chain` is `"all-mainnets"` and `chains` lists the chain names queried (e.g. `["mainnet","arbitrum","optimism"]`).

When filtering by `--chain` without `--asset`, events are filtered client-side. In this case `total` and `totalPages` are `null`, `chainFiltered` is `true`, and a `note` field explains the limitation.

With `--asset`, mode is `"pool-activity"` and adds `asset`, `pool`, and `scope` fields. Pagination totals are accurate (server-side filtering).

#### `stats global`

Protocol-wide statistics. This is the default subcommand for `stats`. Always shows aggregate cross-chain data. The `--chain` flag is **not** supported for `stats global`; use `stats pool --asset <symbol> --chain <chain>` for chain-specific data.

```bash
privacy-pools stats global --agent
privacy-pools stats --agent  # same as above
```

JSON payload: `{ mode: "global-stats", chain: "all-mainnets", chains, cacheTimestamp, allTime, last24h, perChain? }`

`chains` lists the chain names queried and `perChain` contains per-chain `{ chain, cacheTimestamp, allTime, last24h }` entries.

`allTime` and `last24h` are objects provided by the ASP. Expected fields: `tvlUsd`, `avgDepositSizeUsd`, `totalDepositsCount`, `totalWithdrawalsCount`, `totalDepositsValue`, `totalWithdrawalsValue`, `totalDepositsValueUsd`, `totalWithdrawalsValueUsd`.

#### `stats pool`

Per-pool statistics.

```bash
privacy-pools stats pool --asset ETH --agent
```

JSON payload: `{ mode: "pool-stats", chain, asset, pool, scope, cacheTimestamp, allTime, last24h }`

#### `status`

Configuration and health check.

```bash
privacy-pools status --agent
privacy-pools status --agent --check
```

JSON payload: `{ configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, recoveryPhraseSet, signerKeySet, signerKeyValid, signerAddress, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned, recommendedMode, blockingIssues?: [{ code, message, affects[] }], warnings?: [{ code, message, affects[] }], nextActions?: [{ command, reason, when, args?, options?, runnable? }], aspLive?, rpcLive?, rpcBlockNumber? }`

`readyForDeposit`, `readyForWithdraw`, and `readyForUnsigned` are **configuration capability** flags: they indicate the wallet is set up for those operations, **not** that privately withdrawable funds exist. `recommendedMode`, `blockingIssues[]`, and `warnings[]` are the higher-level preflight contract for agents. To verify fund availability before withdrawing on a specific chain, check `accounts --agent --chain <chain>`. Use bare `accounts --agent` only for the default multi-chain mainnet dashboard. `nextActions` provides the canonical CLI follow-up to run next: it points to `init` when setup is incomplete, to `pools` when no deposits exist, or to `accounts` when deposits already exist. If the recovery phrase is configured but no valid signer key is available, those follow-ups stay read-only while `readyForDeposit` remains `false`. `aspLive`, `rpcLive`, and `rpcBlockNumber` are included by default when a chain is selected (via `--chain` or default chain). Pass `--no-check` to suppress health checks, or use `--check-rpc` / `--check-asp` to run only specific checks.
When `rpcUrl` or `aspHost` comes from a custom endpoint, the CLI redacts userinfo, query strings, and token-like path segments before printing them.

#### `capabilities`

Machine-readable discovery manifest.

```bash
privacy-pools capabilities --agent
```

JSON payload: `{ commands[], commandDetails{}, executionRoutes{}, globalFlags[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], protocol{}, runtime{}, safeReadOnlyCommands[], jsonOutputContract, documentation?: { reference, agentGuide, changelog, runtimeUpgrades, jsonContract } }`

`schemas.nextActions` documents the shared canonical shape used by commands that emit machine follow-up guidance. `executionRoutes` is the canonical execution-ownership map. `commandDetails` now also exposes per-command risk metadata: `sideEffectClass`, `touchesFunds`, `requiresHumanReview`, and `preferredSafeVariant?`. `safeReadOnlyCommands` is separate: it only describes wallet-mutating safety, not whether a command runs in JS or native. `protocol` and `runtime` expose the current protocol profile plus bridge/storage compatibility versions for future upgrades. `documentation` points agents to the bundled reference docs and machine-contract artifacts shipped with the CLI package.

#### `describe`

Describe one command for runtime agent introspection.

```bash
privacy-pools describe withdraw quote --agent
privacy-pools describe stats global --agent
```

JSON payload: `{ command, description, aliases, usage, flags, globalFlags, requiresInit, expectedLatencyClass, safeReadOnly, sideEffectClass, touchesFunds, requiresHumanReview, preferredSafeVariant?, prerequisites, examples, jsonFields, jsonVariants, safetyNotes, supportsUnsigned, supportsDryRun, agentWorkflowNotes }`

### Wallet Required

These commands require `privacy-pools init` to have been run first.

#### `init`

Initialize wallet and configuration.

```bash
privacy-pools init --agent --default-chain mainnet --show-mnemonic
privacy-pools init --agent --mnemonic-file ./recovery.txt --default-chain mainnet
cat phrase.txt | privacy-pools init --agent --mnemonic-stdin --default-chain mainnet
privacy-pools init --agent --private-key-file ./signer-key.txt --default-chain mainnet
printf '%s\n' 0x... | privacy-pools init --agent --mnemonic-file ./recovery.txt --private-key-stdin --default-chain mainnet
```

JSON payload: `{ defaultChain, signerKeySet, recoveryPhraseRedacted? | recoveryPhrase?, warning?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }`

When `--show-mnemonic` is passed (and a new recovery phrase was generated), `recoveryPhrase` contains that recovery phrase. Otherwise `recoveryPhraseRedacted: true` and a `warning` field is included indicating the recovery phrase must be captured. When importing an existing recovery phrase, neither field is present.

Newly generated CLI recovery phrases use 24 words (256-bit entropy). Imported recovery phrases may be either 12 or 24 words.

When `init` imports an existing recovery phrase, `nextActions` points to `accounts --agent --all-chains` so agents can check for Pool Accounts across mainnets and testnets. Legacy pre-upgrade accounts may need website migration or website-based recovery before the CLI can restore them safely. When `init` generates a new wallet, `nextActions` points to `status --agent --chain <defaultChain>` instead.

> **CRITICAL**: When generating a new recovery phrase, always pass `--show-mnemonic` to capture it in JSON output. Without this flag, the recovery phrase is stored on disk but not returned. You cannot retrieve it later via the CLI. Losing the recovery phrase means losing access to all deposited funds.

> **Agent handoff**: After `init`, agents should have `PRIVACY_POOLS_PRIVATE_KEY` set in their environment before running any transaction commands. See [Preflight Check](#preflight-check).

Use only one secret stdin source per invocation: either `--mnemonic-stdin` or `--private-key-stdin`.

Inline `--mnemonic` and `--private-key` are still supported as a last resort, but they are intentionally omitted from the primary examples because shell history and process listings can expose them.

Proof commands provision circuit artifacts automatically on first use (~60s one-time), caching them under `~/.privacy-pools/circuits/v<sdk-version>` by default and verifying them against the shipped checksum manifest before use. Set `PRIVACY_POOLS_CIRCUITS_DIR` to use a pre-provisioned directory.

#### `flow`

Persisted easy-path workflow that compresses the normal deposit -> ASP review -> relayed private withdrawal journey without changing any manual commands.

```bash
privacy-pools flow start 0.1 ETH --to 0xRecipient --agent
privacy-pools flow start 0.1 ETH --to 0xRecipient --watch --agent
privacy-pools flow start 100 USDC --to 0xRecipient --new-wallet --export-new-wallet ./flow-wallet.txt --agent
privacy-pools flow watch latest --agent
privacy-pools flow status latest --agent
privacy-pools flow ragequit latest --agent
```

`flow start` performs the public deposit, saves a workflow locally, and targets a later relayed private withdrawal from that same Pool Account to the saved recipient. The saved workflow always withdraws the full remaining balance of that same Pool Account at execution time.

Creating or advancing a saved flow requires `init`. `flow status` is read-only and works as long as a saved workflow snapshot already exists locally.

Like `deposit`, `flow start` rejects non-round amounts by default in machine modes because unique amounts can fingerprint the deposit. Prefer round amounts unless you intentionally accept that privacy tradeoff.

With `--new-wallet`, the CLI generates a dedicated workflow wallet for that one flow. ETH workflows wait for the full ETH target. ERC20 workflows wait for both the token amount and a native ETH gas reserve in the same wallet. In non-interactive mode, `--export-new-wallet <path>` is required so the generated private key is backed up before the flow begins.

Saved flows persist local state under `~/.privacy-pools/workflows/`. `flow --new-wallet` also stores the per-workflow private key under `~/.privacy-pools/workflow-secrets/` until the workflow completes, public-recovers, or is externally stopped, so `--export-new-wallet` is a backup copy rather than the only stored copy.

`flow watch` re-checks the saved workflow and advances it using the same real branches as the frontend and protocol. Workflow `phase` values include `awaiting_funding`, `depositing_publicly`, `awaiting_asp`, `approved_ready_to_withdraw`, `withdrawing`, `completed`, `completed_public_recovery`, `paused_declined`, `paused_poi_required`, and `stopped_external`. Deposit review state remains available separately in `aspStatus`. When the Pool Account is approved, `flow watch` performs the relayed private withdrawal automatically. If it is `declined`, the workflow pauses and surfaces `flow ragequit` as the canonical recovery path. If it is `poi_required`, the workflow pauses until Proof of Association is completed externally. `flow watch` is intentionally unbounded; agents that need a wall-clock limit should wrap it in their own external timeout.

`flow ragequit` performs the public recovery path for a saved workflow. For `walletMode = "new_wallet"` it uses the stored workflow wallet key. For `walletMode = "configured"` it must use the original depositor signer that created the saved workflow.

JSON payload: `{ mode: "flow", action: "start" | "watch" | "status" | "ragequit", workflowId, phase, walletMode?, walletAddress?, requiredNativeFunding?, requiredTokenFunding?, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId?, poolAccountNumber?, depositTxHash?, depositBlockNumber?, depositExplorerUrl?, committedValue?, aspStatus?, withdrawTxHash?, withdrawBlockNumber?, withdrawExplorerUrl?, ragequitTxHash?, ragequitBlockNumber?, ragequitExplorerUrl?, lastError?, nextActions? }`

Paused workflow states are successful command results, not CLI errors. `Ctrl-C` during `flow watch` detaches cleanly without deleting the saved workflow. For ERC20 relayed withdrawals inside `flow`, the CLI requests extra gas by default, matching `withdraw`.

#### `deposit`

Deposit ETH or ERC-20 tokens into a Privacy Pool.

```bash
privacy-pools deposit 0.1 ETH --agent
```

JSON payload: `{ operation: "deposit", txHash, amount, committedValue, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber, explorerUrl, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }`

All numeric values are strings (wei). `committedValue` and `label` may be `null`.

`nextActions` provides the canonical structured guidance: poll `accounts --agent --chain <chain> --pending-only` while the Pool Account remains pending, then re-run `accounts --agent --chain <chain>` to confirm whether it was approved, declined, or `poi_required` before choosing `withdraw` or `ragequit`. Always preserve the same `--chain` scope for both polling and confirmation. Bare `accounts` only covers the mainnet chains, so testnet deposits would be invisible without `--chain`.

Deposits are reviewed by the ASP before approval. Most approve within 1 hour; some may take up to 7 days. A vetting fee is deducted from the deposit amount by the ASP. Only approved deposits can use `withdraw` (relayed or direct). Declined deposits must `ragequit` publicly to the deposit address.

**Privacy guard**: In machine modes (`--json`, `--agent`, `--yes`, `--dry-run`, `--unsigned`), non-round deposit amounts are rejected by default because they can fingerprint the deposit. Prefer round amounts. Pass `--ignore-unique-amount` only when you intentionally want to bypass that protection.

#### `withdraw`

Withdraw from a Privacy Pool. Relayed by default (recommended for privacy).

```bash
privacy-pools withdraw 0.05 ETH --to 0xRecipient --agent
privacy-pools withdraw 0.05 ETH --to 0xRecipient --from-pa PA-2 --agent
privacy-pools withdraw --all ETH --to 0xRecipient --agent
privacy-pools withdraw 50% ETH --to 0xRecipient --agent
privacy-pools withdraw 0.1 ETH --direct --agent
privacy-pools withdraw 0.05 ETH --to 0xRecipient --no-extra-gas --agent
```

JSON payload (relayed): `{ operation: "withdraw", mode: "relayed", txHash, blockNumber, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS, extraGas?, remainingBalance, anonymitySet?: { eligible, total, percentage }, nextActions?: [...] }`

JSON payload (direct): same but `mode: "direct"`, `feeBPS: null`, no `extraGas`. Human output includes a privacy note about direct withdrawals linking deposit and withdrawal onchain.

> **Note**: Direct withdrawals (`--direct`) are not privacy-preserving. ASP approval is still required for both relayed and direct withdrawals. If a deposit is `poi_required`, complete Proof of Association first. If it is declined, use `ragequit` instead.

**Amount shortcuts:**
- `--all`: Withdraw the entire Pool Account balance
- Percentages (`50%`, `100%`): Withdraw a percentage of the PA balance
- After PA selection, the CLI shows the selected PA's available balance

**Extra gas (ERC20 only):** For ERC20 token withdrawals, `--extra-gas` (default: true) requests gas tokens alongside the withdrawal. Use `--no-extra-gas` to opt out. Ignored for native ETH withdrawals.

For relayed withdrawals, the CLI also warns if the chosen amount would leave a positive remainder below the relayer minimum. In that case, withdraw less, use `--all` / `100%`, or plan to recover the leftover balance publicly later.

**Withdrawal quote:**

```bash
privacy-pools withdraw quote 0.1 ETH --to 0xRecipient --agent
```

JSON payload: `{ mode: "relayed-quote", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, extraGas?, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }`

Relayed withdrawals use a fee quote that expires after ~60 seconds. If proof generation takes longer, the CLI will auto-refresh the quote if the fee hasn't changed. If the fee changes, re-run the command to generate a fresh proof. `nextActions` provides the canonical `withdraw` follow-up; check `runnable` because quotes without a recipient produce a template action that still needs `--to`.

#### `ragequit` (alias: `exit`)

Emergency exit without ASP approval. Reveals the deposit address onchain; no privacy is gained. Asset resolution still works when public pool discovery is offline or incomplete because the CLI falls back to a built-in pool registry verified on-chain.

```bash
privacy-pools exit ETH --from-pa PA-1 --agent
privacy-pools ragequit ETH --from-pa PA-1 --agent   # same thing
```

JSON payload: `{ operation: "ragequit", txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber, explorerUrl, nextActions?: [...] }`

#### `accounts`

List Pool Accounts with their approval status and per-pool balance totals.

```bash
privacy-pools accounts --agent
privacy-pools accounts --agent --all-chains
privacy-pools accounts --agent --summary
privacy-pools accounts --agent --chain <chain> --pending-only
privacy-pools accounts --agent --details
```

When no `--chain` is specified, `accounts` aggregates all CLI-supported mainnet chains by default. Use `--all-chains` to include testnets.

JSON payload: `{ chain, allChains?, chains?, warnings?, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash, explorerUrl, chain?, chainId? }], balances: [{ asset, balance, usdValue, poolAccounts, chain?, chainId? }], pendingCount, nextActions?: [{ command, reason, when, args?, options?, runnable? }] }`

In multi-chain responses, `poolAccountId` remains chain-local, so pair it with `chain` or `chainId` before using it in follow-up commands.

`balances` contains per-pool totals for Pool Accounts with remaining balance. `balance` is the total amount in wei (string). `usdValue` is a formatted USD string (or null if price data is unavailable).

`--summary` JSON payload: `{ chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poiRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions? }`

`--pending-only` JSON payload: `{ chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions? }`

**Poll pending approvals**: After depositing, poll `accounts --agent --chain <chain> --pending-only` while the Pool Account remains pending. Because this mode only returns pending accounts, reviewed entries disappear from the response instead of changing in place. Once it disappears, re-run `accounts --agent --chain <chain>` to confirm whether it became `"approved"`, `"declined"`, or `"poi_required"`. Withdraw only after approval; if declined, use `ragequit`; if `poi_required`, complete Proof of Association first. Always preserve the same `--chain` for both polling and confirmation. Bare `accounts` only covers the mainnet chains. `nextActions` on `accounts` are poll-oriented only and appear when pending approvals still exist.

#### `migrate status`

Read-only legacy migration or recovery readiness check on CLI-supported chains.

```bash
privacy-pools migrate status --agent
privacy-pools migrate status --agent --all-chains
privacy-pools migrate status --agent --chain mainnet
```

`migrate status` rebuilds the legacy account view from the installed SDK, the built-in CLI pool registry for CLI-supported chains, and current onchain events without persisting trusted account state. It reports whether legacy pre-upgrade commitments still need website migration, already appear fully migrated, require website-based public recovery because they were declined, or cannot be classified safely because ASP review data is incomplete. The CLI does **not** submit migration transactions.

Without `--chain`, `migrate status` checks all CLI-supported mainnet chains by default. Use `--all-chains` to include supported testnets. Like other multi-chain read-only commands, `--rpc-url` is only valid with `--chain <name>`. Review beta or other website-only migration surfaces in the Privacy Pools website.

JSON payload: `{ mode: "migration-status", chain, allChains?, chains?, warnings?, status, requiresMigration, requiresWebsiteRecovery, isFullyMigrated, readinessResolved, submissionSupported: false, requiredChainIds, migratedChainIds, missingChainIds, websiteRecoveryChainIds, unresolvedChainIds, chainReadiness: [{ chain, chainId, status, candidateLegacyCommitments, expectedLegacyCommitments, migratedCommitments, legacyMasterSeedNullifiedCount, hasPostMigrationCommitments, isMigrated, legacySpendableCommitments, upgradedSpendableCommitments, declinedLegacyCommitments, reviewStatusComplete, requiresMigration, requiresWebsiteRecovery, scopes }] }`

When `readinessResolved` is `false`, treat the result as incomplete and review the account in the Privacy Pools website before acting on it.

#### `history`

Chronological event history.

```bash
privacy-pools history --agent --limit 50
```

JSON payload: `{ chain, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }] }`

`type` is `"deposit"`, `"withdrawal"`, or `"ragequit"`.

#### `sync`

Force-sync local account state from onchain events. Most commands auto-sync with a 2-minute freshness TTL, so explicit sync is rarely needed.

```bash
privacy-pools sync --agent
privacy-pools sync --agent --asset ETH
```

JSON payload: `{ chain, syncedPools, syncedSymbols?, availablePoolAccounts, previousAvailablePoolAccounts? }`

## Auto-Sync Behavior

Query commands auto-sync with a 2-minute freshness TTL. If data was synced within the last 2 minutes, the sync is skipped for faster responses. The `sync` command always force-refreshes regardless of freshness.

| Command    | Auto-syncs? | Override      |
| ---------- | ----------- | ------------- |
| accounts   | Yes (TTL)   | --no-sync     |
| history    | Yes (TTL)   | --no-sync     |
| deposit    | Yes         | N/A           |
| withdraw   | Yes         | N/A           |
| ragequit   | Yes         | N/A           |
| sync       | Always      | N/A           |
| pools      | No          | N/A (public)  |
| activity   | No          | N/A (public)  |
| stats      | No          | N/A (public)  |

## Polling for ASP Approval

After depositing, poll `accounts --agent --chain <chain> --pending-only` while the deposit remains pending:

- **Initial interval**: 60 seconds
- **Backoff**: exponential, max 5 minutes between polls
- **Most deposits approve within 1 hour**
- **Maximum wait**: 7 days (rare edge cases)
- Once the Pool Account disappears from pending-only results, re-run `accounts --agent --chain <chain>` to confirm whether it is approved, declined, or `poi_required` before choosing `withdraw` or `ragequit`
- Always preserve `--chain`; bare `accounts` only covers the mainnet chains, so testnet deposits are invisible without it

## Crash Recovery

Deposits are not idempotent. If a deposit fails after tx submission (e.g., CLI crashes between onchain confirmation and local state save), run `sync --agent` to detect the onchain deposit before retrying. Running `deposit` again without syncing will create a new deposit.

For withdrawals: if the CLI crashes after proof generation but before relay submission, the proof is lost and must be regenerated. Re-run the withdraw command.

## Unsigned Transaction Mode

For agents that manage their own signing (e.g., custodial wallets, multisigs, MPC signers), `--unsigned` builds ready-to-sign transaction payloads without submitting them.

### Envelope format (default)

```bash
privacy-pools deposit 0.1 ETH --unsigned --agent
```

```json
{
  "schemaVersion": "1.6.0",
  "success": true,
  "mode": "unsigned",
  "operation": "deposit",
  "chain": "mainnet",
  "asset": "ETH",
  "amount": "100000000000000000",
  "precommitment": "12345...",
  "transactions": [
    {
      "chainId": 1,
      "from": null,
      "to": "0x6818809eefce719e480a7526d76bd3e561526b46",
      "value": "100000000000000000",
      "data": "0xb6b55f25...",
      "description": "Deposit ETH into Privacy Pool"
    }
  ]
}
```

### Raw tx format

```bash
privacy-pools deposit 0.1 ETH --unsigned tx --agent
```

```json
[
  {
    "to": "0x6818...",
    "data": "0xb6b55f25...",
    "value": "100000000000000000",
    "valueHex": "0x16345785d8a0000",
    "chainId": 1,
    "description": "Deposit ETH into Privacy Pool"
  }
]
```

### Supported operations

| Command    | `--unsigned` | Notes                                           |
| ---------- | ------------ | ----------------------------------------------- |
| `deposit`  | Yes          | May include ERC-20 approve tx + deposit tx      |
| `withdraw` | Yes          | Includes ZK proof in calldata                   |
| `ragequit` | Yes          | Includes ZK proof in calldata                   |

### Envelope extra fields by operation

- **Deposit**: `precommitment`
- **Withdraw (direct)**: `withdrawMode: "direct"`, `recipient`, `selectedCommitmentLabel`, `selectedCommitmentValue`
- **Withdraw (relayed)**: `withdrawMode: "relayed"`, `recipient`, `selectedCommitmentLabel`, `selectedCommitmentValue`, `feeBPS`, `quoteExpiresAt`, `relayerRequest`
- **Ragequit**: `selectedCommitmentLabel`, `selectedCommitmentValue`

### Integration with external signers

```
1. Agent calls: privacy-pools deposit 0.1 ETH --unsigned --agent
2. Agent receives transactions[] array
3. Agent signs each transaction with its own key
4. Agent submits signed transactions to the network
5. Agent calls: privacy-pools accounts --agent --chain <chain> --pending-only  (to verify the deposit landed; preserve chain scope)
```

## Dry-Run Mode

Validate inputs, check balances, and preview transaction details without submitting:

```bash
privacy-pools deposit 0.1 ETH --dry-run --agent
privacy-pools withdraw 0.05 ETH --to 0x... --dry-run --agent
privacy-pools ragequit ETH --from-pa PA-1 --dry-run --agent
```

Dry-run responses include `"dryRun": true` and all validation results.

## Error Handling

### Error codes

| Code                                 | Category | Retryable | Meaning                                    |
| ------------------------------------ | -------- | --------- | ------------------------------------------ |
| `INPUT_ERROR`                        | INPUT    | No        | Bad arguments, missing flags               |
| `RPC_ERROR`                          | RPC      | No        | RPC call failure                            |
| `RPC_NETWORK_ERROR`                  | RPC      | Yes       | Network connectivity issue                  |
| `RPC_RATE_LIMITED`                   | RPC      | Yes       | RPC provider rate limit (429); use --rpc-url|
| `RPC_POOL_RESOLUTION_FAILED`         | RPC      | Yes       | Pool resolution failed (ASP + RPC both down)|
| `ASP_ERROR`                          | ASP      | No        | ASP service failure                         |
| `RELAYER_ERROR`                      | RELAYER  | No        | Relayer request failure                     |
| `PROOF_ERROR`                        | PROOF    | No        | Proof generation failure                    |
| `PROOF_GENERATION_FAILED`            | PROOF    | No        | ZK proof could not be generated             |
| `PROOF_MERKLE_ERROR`                 | PROOF    | Yes       | Commitment not in Merkle tree (sync first)  |
| `PROOF_MALFORMED`                    | PROOF    | No        | Corrupt proof data                          |
| `CONTRACT_NULLIFIER_ALREADY_SPENT`   | CONTRACT | No        | Pool Account already withdrawn              |
| `CONTRACT_INCORRECT_ASP_ROOT`        | CONTRACT | Yes       | State changed, regenerate proof             |
| `CONTRACT_UNKNOWN_STATE_ROOT`        | CONTRACT | Yes       | State root changed, regenerate proof        |
| `CONTRACT_CONTEXT_MISMATCH`          | CONTRACT | No        | Proof context does not match withdrawal     |
| `CONTRACT_INVALID_PROOF`             | CONTRACT | No        | Proof rejected onchain                      |
| `CONTRACT_INVALID_PROCESSOOOR`       | CONTRACT | No        | Wrong withdrawal mode                       |
| `CONTRACT_INVALID_COMMITMENT`        | CONTRACT | No        | Selected Pool Account is no longer valid    |
| `CONTRACT_PRECOMMITMENT_ALREADY_USED`| CONTRACT | No        | Duplicate precommitment, retry deposit      |
| `CONTRACT_ONLY_ORIGINAL_DEPOSITOR`   | CONTRACT | No        | Wrong signer for exit                       |
| `CONTRACT_NOT_YET_RAGEQUITTEABLE`    | CONTRACT | Yes       | Pool Account cannot be exited yet           |
| `CONTRACT_MAX_TREE_DEPTH_REACHED`    | CONTRACT | No        | Pool has reached max deposit capacity       |
| `CONTRACT_NO_ROOTS_AVAILABLE`        | CONTRACT | Yes       | Pool not ready, wait and retry              |
| `CONTRACT_MINIMUM_DEPOSIT_AMOUNT`    | CONTRACT | No        | Deposit amount is below the pool minimum    |
| `CONTRACT_INVALID_DEPOSIT_VALUE`     | CONTRACT | No        | Deposit amount is too large                 |
| `CONTRACT_INVALID_WITHDRAWAL_AMOUNT` | CONTRACT | No        | Withdrawal amount is invalid                |
| `CONTRACT_POOL_NOT_FOUND`            | CONTRACT | No        | Requested pool is unavailable on this chain |
| `CONTRACT_POOL_IS_DEAD`              | CONTRACT | No        | Pool no longer accepts activity             |
| `CONTRACT_RELAY_FEE_GREATER_THAN_MAX`| CONTRACT | Yes       | Relayer fee exceeds pool maximum            |
| `CONTRACT_INVALID_TREE_DEPTH`        | CONTRACT | No        | Proof inputs do not match pool tree depth   |
| `CONTRACT_NATIVE_ASSET_TRANSFER_FAILED`| CONTRACT | No      | Native asset transfer to the destination failed |
| `CONTRACT_INSUFFICIENT_FUNDS`        | CONTRACT | No        | Wallet lacks ETH for amount + gas           |
| `CONTRACT_NONCE_ERROR`               | CONTRACT | Yes       | Nonce conflict; pending tx may be stuck     |
| `ACCOUNT_MIGRATION_REQUIRED`         | INPUT    | No        | Legacy pre-upgrade account must be migrated in the website before CLI restore/sync |
| `ACCOUNT_WEBSITE_RECOVERY_REQUIRED`  | INPUT    | No        | Legacy declined deposits require website-based recovery before CLI restore/sync |
| `ACCOUNT_MIGRATION_REVIEW_INCOMPLETE`| ASP      | Yes       | Legacy ASP review data is incomplete; retry before acting on restore/sync |
| `ACCOUNT_NOT_APPROVED`               | ASP      | No        | Deposit is not approved for withdrawal; it may still be pending, may require Proof of Association, or may have been declined |
| `UNKNOWN_ERROR`                      | UNKNOWN  | No        | Unexpected error                            |

### Exit codes

| Code | Category |
| ---- | -------- |
| 0    | Success  |
| 1    | Unknown  |
| 2    | Input    |
| 3    | RPC      |
| 4    | ASP      |
| 5    | Relayer  |
| 6    | Proof    |
| 7    | Contract |

### Retry strategy

When `retryable: true` is present in the error response:

1. For `RPC_NETWORK_ERROR`, `RPC_RATE_LIMITED`, or `RPC_POOL_RESOLUTION_FAILED`: exponential backoff (1s, 2s, 4s), max 3 retries. For rate limits, consider switching to a dedicated RPC with `--rpc-url`.
2. For `CONTRACT_INCORRECT_ASP_ROOT`, `CONTRACT_UNKNOWN_STATE_ROOT`, or `PROOF_MERKLE_ERROR`: run `sync --agent` first, then retry the original command
3. For `CONTRACT_NO_ROOTS_AVAILABLE`, `CONTRACT_NONCE_ERROR`, `CONTRACT_RELAY_FEE_GREATER_THAN_MAX`, or `CONTRACT_NOT_YET_RAGEQUITTEABLE`: wait 30-60s or request a fresh quote, then retry

When `retryable: false` (non-retryable):

4. For `ACCOUNT_MIGRATION_REQUIRED`: review the account in the Privacy Pools website first, migrate the legacy account there, then rerun the CLI restore or sync command.
5. For `ACCOUNT_WEBSITE_RECOVERY_REQUIRED`: review the account in the Privacy Pools website first and use the website's recovery flow for declined legacy deposits, then rerun the CLI restore or sync command.
6. For `ACCOUNT_MIGRATION_REVIEW_INCOMPLETE`: retry when ASP connectivity is healthy, or run `privacy-pools migrate status --agent` and wait for `readinessResolved: true` before acting on this account.
7. For `ACCOUNT_NOT_APPROVED`: suggest running `privacy-pools accounts --agent --chain <chain>` to check `aspStatus`, preserving the same chain scope used for the withdrawal attempt. If `aspStatus` is `pending`, continue polling. If it is `poi_required`, complete Proof of Association first. If it is `declined`, the recovery path is `privacy-pools ragequit --chain <chain> --asset <symbol> --from-pa <PA-#>`.

## Supported Chains

| Name         | Chain ID   | Testnet | Notes                           |
| ------------ | ---------- | ------- | ------------------------------- |
| `mainnet`    | 1          | No      | Default chain, largest pools    |
| `arbitrum`   | 42161      | No      | Lower gas costs                 |
| `optimism`   | 10         | No      | Lower gas costs                 |
| `sepolia`    | 11155111   | Yes     | For testing                     |
| `op-sepolia` | 11155420   | Yes     | For testing (OP Stack)          |

`ethereum` is accepted as an alias for `mainnet`.

Specify with `--chain <name>` or set a default via `init --default-chain <name>`.

## Runtime Discovery

For fully dynamic integration, call `capabilities --agent` at startup to receive a machine-readable manifest of all commands, command details, execution routes, protocol/runtime compatibility metadata, supported chains, and the JSON output contract. Use `describe <command...> --agent` when you need the detailed runtime contract for one command path. This is useful if you cannot read this file at integration time.
