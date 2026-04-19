# Agent Integration Guide

This document is for AI agents, bots, and programmatic consumers of the Privacy Pools CLI. For human users, see [`README.md`](README.md) or run `privacy-pools guide`.

For flags, configuration, and environment variables, see [`docs/reference.md`](docs/reference.md). For native runtime troubleshooting and fallback controls, see [`docs/runtime-upgrades.md`](docs/runtime-upgrades.md). For release history, see [`CHANGELOG.md`](CHANGELOG.md).

> **Skill files**: For Bankr, Claude Code, and other skill-aware agents, see [`skills/privacy-pools-cli/SKILL.md`](skills/privacy-pools-cli/SKILL.md) and [`skills/privacy-pools-cli/reference.md`](skills/privacy-pools-cli/reference.md).

## Quick Start

```bash
# Install (recommended for agents)
npm i -g privacy-pools-cli
# Keep optional dependencies enabled so supported hosts can use the native shell.
# Avoid --omit=optional and configs such as npm_config_omit=optional.

# Unreleased/source builds
npm i -g github:0xmatthewb/privacy-pools-cli

# Discover capabilities (no wallet needed)
privacy-pools capabilities --agent
privacy-pools describe withdraw quote --agent

# Browse pools (no wallet needed)
privacy-pools pools --agent
privacy-pools upgrade --agent --check

# Easy workflow
privacy-pools status --agent
privacy-pools init --agent --default-chain mainnet --show-recovery-phrase
privacy-pools init --agent --default-chain mainnet --backup-file ./privacy-pools-recovery.txt
privacy-pools flow start 0.1 ETH --to 0xRecipient --agent
privacy-pools flow status latest --agent
privacy-pools flow step latest --agent
privacy-pools flow ragequit latest --agent    # saved-workflow public recovery if declined, relayer-blocked, or you intentionally choose the public path

# Manual workflow
privacy-pools simulate deposit 0.1 ETH --agent                  # same JSON as deposit --dry-run; preview-only
privacy-pools deposit 0.1 ETH --agent --no-wait
privacy-pools tx-status <submissionId> --agent                  # poll until the deposit transaction confirms
privacy-pools accounts --agent --chain mainnet --pending-only   # poll while the deposit remains pending; preserve the same --chain on other networks
privacy-pools accounts --agent --chain mainnet                  # once pending disappears, confirm approved vs declined vs poa_required
privacy-pools migrate status --agent --include-testnets               # read-only legacy migration or recovery check on CLI-supported chains
privacy-pools withdraw --all ETH --to 0xRecipient --agent --no-wait
privacy-pools tx-status <submissionId> --agent                  # poll until the withdrawal confirms
privacy-pools broadcast ./signed-envelope.json --agent --no-wait   # optional inverse for full-envelope offline signing flows
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

Linux native packaging currently targets x64 glibc hosts. Alpine and other
musl-based environments fall back to the JS launcher automatically.

For agent onboarding, prefer the plain npm install above on a supported host.
Normal npm installs include the host optional native package automatically.
If a supported published install falls back to JS because the optional native
package is missing or invalid, `status --agent` includes the warning code
`native_acceleration_unavailable`. The CLI remains fully functional, but
read-only discovery commands will be slower until the package is reinstalled
without omitting optional dependencies.

## Core Concepts

**Agent mode**: Pass `--agent` to any command. This is equivalent to `--json --yes --quiet`: machine-readable JSON on stdout, no interactive prompts, no banners or progress text.

**Dual output**: Structured JSON always goes to **stdout**. Human-readable command output goes to **stderr**, except built-in help, welcome, and shell completion text, which write to **stdout**. In `--agent` mode, stderr is suppressed.

**JSON envelope**: Every response follows the schema:

```
{ "schemaVersion": "2.0.0", "success": true, ...payload }
{ "schemaVersion": "2.0.0", "success": false, "errorCode": "...", "errorMessage": "...", "error": { ... } }
```

Parse `success` first. On failure, read `error.code` for programmatic handling and `error.hint` for remediation. `errorCode` and `errorMessage` remain v2 compatibility aliases and match `error.code` and `error.message`. Check `error.retryable` before deciding to retry.

Some success payloads also include optional `nextActions[]` workflow guidance in the form `{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }`. Treat `nextActions` as the canonical machine follow-up field. When `runnable = false`, the action is a template and needs additional user input before execution.

The complete JSON output contract is defined in [`docs/contracts/cli-json-contract.v2.0.0.json`](docs/contracts/cli-json-contract.v2.0.0.json). For a stable bundled machine-contract path inside the installed package, prefer `docs/contracts/cli-json-contract.current.json`. Installed packages include that stable path plus the active schema snapshot for the packaged CLI version. The repository may retain older versioned snapshots for historical reference, and runtime discovery metadata may still point at the exact versioned snapshot for the active schema.

### NextActions Specification

`nextActions` are included in success JSON responses from most commands. In `--agent`, they remain present on stdout even though `--agent` implies `--quiet`; quiet mode only suppresses human-oriented stderr sections such as "Next steps". Read-only listing commands may include `nextActions` when there is a useful machine follow-up.

**`when` discriminator values:**

Each `nextActions` entry carries a `when` field from the `NextActionWhen` discriminator. Agents use this to decide programmatically whether a suggested action is relevant.

| `when` value | Fires when |
| --- | --- |
| `after_init` | After successful initialization (new wallet or restore) |
| `after_restore` | After importing an existing recovery phrase |
| `after_submit` | After a write command returns immediately with `status: "submitted"` |
| `after_deposit` | After a deposit transaction is confirmed onchain |
| `after_dry_run` | After a successful dry-run validation (no tx submitted) |
| `after_quote` | After a relayed withdrawal fee quote is returned |
| `after_withdraw` | After a withdrawal is finalized onchain |
| `after_ragequit` | After a public recovery (ragequit) is confirmed |
| `after_guide` | After viewing a guide topic or the guide index |
| `after_describe` | After viewing command metadata or an envelope schema path |
| `after_capabilities` | After viewing the runtime capabilities manifest |
| `after_completion` | After viewing or installing shell completion output |
| `has_pending` | When pending deposits exist that need ASP review monitoring |
| `status_not_ready` | When status detects setup is incomplete (no init) |
| `status_unsigned_no_accounts` | Status shows unsigned-only mode, no accounts yet |
| `status_unsigned_has_accounts` | Status shows unsigned-only mode, accounts exist |
| `status_ready_no_accounts` | Status shows full readiness, no accounts yet |
| `status_ready_has_accounts` | Status shows full readiness, accounts exist |
| `status_degraded_health` | Status detects degraded RPC or ASP connectivity |
| `status_restore_discovery` | Status suggests restore/discovery for imported phrases |
| `after_sync` | After a forced or auto sync of local account state |
| `after_pools` | After listing available pools |
| `after_pool_detail` | After viewing detail for a specific pool |
| `after_upgrade` | After checking for or performing a CLI upgrade |
| `after_activity` | After viewing the public activity feed |
| `after_stats` | After viewing global or aggregate stats |
| `after_pool_stats` | After viewing stats for a specific pool |
| `after_history` | After viewing private account history |
| `after_config_list` | After listing local configuration |
| `after_config_set` | After updating local configuration |
| `no_pools_found` | Pool discovery found no pools and suggests diagnostics |
| `accounts_pending_empty` | Pending-only account polling found no pending entries |
| `accounts_summary_empty` | Compact account summary found no matching accounts |
| `accounts_empty` | Account listing found no matching accounts |
| `accounts_other_chain_activity` | Account listing found activity on other chains |
| `accounts_restore_check` | Account listing suggests restore or discovery follow-up |
| `flow_manual_followup` | Flow requires a manual agent action to continue |
| `flow_public_recovery_pending` | Flow public recovery (ragequit) is in progress |
| `flow_public_recovery_required` | Flow must use public recovery (e.g., below relayer minimum) |
| `flow_resume` | Saved flow can be resumed with `flow status` + `flow step` in agent mode, or `flow watch` in human mode |
| `flow_public_recovery_optional` | Public recovery is available as an alternative path |
| `flow_declined` | Flow deposit was declined by the ASP |

**`runnable` semantics:**

When `runnable: true` (or omitted, which defaults to `true`), the `cliCommand` field contains a complete, executable CLI invocation that the agent can run directly. When `runnable: false`, the action is a template -- some arguments (e.g., recipient address, amount) must be filled in by the agent before execution.

**Ordering contract:** When multiple actions are emitted, the first matching action is highest priority. Private or resume paths come first, required public recovery comes before optional public recovery, optional public recovery comes after private paths, and deposit templates come last.

**Agent decision tree for nextActions:**

```
1. Parse the `nextActions` array from the JSON response
2. For each action:
   a. Check `when` -- does this apply to the current agent state?
   b. Check `runnable`:
      - true  -> execute `cliCommand` directly
      - false -> fill in template arguments, then execute
   c. If multiple actions match, prefer the first one (highest priority)
3. If no actions match, the workflow is complete or requires human input
```

### JSON Output Schemas

Every JSON response wraps command-specific data in a standard envelope:

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "...commandPayload": "...",
  "nextActions": [{ "command": "string", "reason": "string", "when": "string", "cliCommand": "string", "runnable": true }]
}
```

**`init` (success):**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "setupMode": "create | restore | signer_only | replace",
  "readiness": "ready | read_only | discovery_required",
  "defaultChain": "mainnet",
  "signerKeySet": true,
  "backupFilePath": "/home/user/privacy-pools-recovery.txt | absent",
  "recoveryPhrase": "word1 word2 ... (only with --show-recovery-phrase)",
  "recoveryPhraseRedacted": true,
  "restoreDiscovery": "{ status, chainsChecked, foundAccountChains? } | absent",
  "warning": "string | absent",
  "nextActions": [...]
}
```

**`init` (`--dry-run`):**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "operation": "init",
  "dryRun": true,
  "effectiveChain": "mainnet",
  "recoveryPhraseSource": "generate new phrase",
  "signerKeySource": "save from file",
  "overwriteExisting": false,
  "overwritePromptRequired": false,
  "writeTargets": [
    "/home/user/.privacy-pools/config.json",
    "/home/user/.privacy-pools/.mnemonic",
    "/home/user/.privacy-pools/.signer"
  ]
}
```

**`deposit` (success):**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "operation": "deposit",
  "status": "submitted | confirmed",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000 | absent",
  "workflowId": "123e4567-e89b-12d3-a456-426614174001",
  "txHash": "0x...",
  "amount": "100000000000000000",
  "committedValue": "99500000000000000 | null",
  "asset": "ETH",
  "chain": "mainnet",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "poolAddress": "0x...",
  "scope": "123...",
  "label": "456... | null",
  "blockNumber": "12345678 | null",
  "explorerUrl": "https://etherscan.io/tx/0x...",
  "warnings": "[{ code, category, message }] | absent",
  "nextActions": [...]
}
```

**`withdraw` (success, relayed):**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "operation": "withdraw",
  "status": "submitted | confirmed",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000 | absent",
  "mode": "relayed",
  "txHash": "0x...",
  "blockNumber": "12345678 | null",
  "amount": "99500000000000000",
  "recipient": "0x...",
  "explorerUrl": "https://etherscan.io/tx/0x...",
  "poolAddress": "0x...",
  "scope": "123...",
  "asset": "ETH",
  "chain": "mainnet",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "feeBPS": "50",
  "extraGas": "boolean | absent",
  "remainingBalance": "0",
  "anonymitySet": "{ eligible, total, percentage } | absent",
  "warnings": "[{ code, category, message }] | absent",
  "nextActions": [...]
}
```

**`ragequit` (success):**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "operation": "ragequit",
  "status": "submitted | confirmed",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000 | absent",
  "txHash": "0x...",
  "amount": "99500000000000000",
  "asset": "ETH",
  "chain": "mainnet",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "poolAddress": "0x...",
  "scope": "123...",
  "blockNumber": "12345678 | null",
  "explorerUrl": "https://etherscan.io/tx/0x...",
  "destinationAddress": "0x... | absent",
  "remainingBalance": "0",
  "warnings": "[{ code, category, message }] | absent",
  "nextActions": [...]
}
```

**`tx-status` (success):**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "operation": "tx-status",
  "submissionId": "123e4567-e89b-12d3-a456-426614174000",
  "sourceOperation": "deposit | withdraw | ragequit | broadcast",
  "sourceCommand": "deposit | withdraw | ragequit | broadcast",
  "chain": "mainnet",
  "asset": "ETH | absent",
  "poolAccountId": "PA-1 | absent",
  "poolAccountNumber": 1,
  "workflowId": "123e4567-e89b-12d3-a456-426614174001 | absent",
  "recipient": "0x... | absent",
  "broadcastMode": "onchain | relayed | absent",
  "broadcastSourceOperation": "deposit | withdraw | ragequit | absent",
  "createdAt": "2026-04-18T12:00:00.000Z",
  "updatedAt": "2026-04-18T12:00:15.000Z",
  "status": "submitted | confirmed | reverted",
  "reconciliationRequired": false,
  "localStateSynced": true,
  "warningCode": "string | absent",
  "lastError": "{ step, errorCode, errorMessage, retryable } | absent",
  "transactions": [
    {
      "index": 0,
      "description": "Deposit ETH into Privacy Pool",
      "txHash": "0x...",
      "explorerUrl": "https://etherscan.io/tx/0x...",
      "blockNumber": "12345678 | null",
      "status": "submitted | confirmed | reverted"
    }
  ],
  "nextActions": [...]
}
```

**`accounts` (default):**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "chain": "mainnet",
  "lastSyncTime": "2026-04-18T12:00:00.000Z | absent",
  "syncSkipped": false,
  "accounts": [
    {
      "poolAccountNumber": 1,
      "poolAccountId": "PA-1",
      "status": "active",
      "aspStatus": "approved",
      "asset": "ETH",
      "scope": "123...",
      "value": "99500000000000000",
      "hash": "0x...",
      "label": "456...",
      "blockNumber": "12345678",
      "txHash": "0x...",
      "explorerUrl": "https://etherscan.io/tx/0x..."
    }
  ],
  "balances": [
    { "asset": "ETH", "balance": "99500000000000000", "usdValue": "$250.00", "poolAccounts": 1 }
  ],
  "pendingCount": 0,
  "nextActions": [...]
}
```

**`pools`:**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "chain": "mainnet",
  "search": null,
  "sort": "tvl-desc",
  "pools": [
    {
      "asset": "ETH",
      "tokenAddress": "0x...",
      "pool": "0x...",
      "scope": "123...",
      "decimals": 18,
      "minimumDeposit": "10000000000000000",
      "vettingFeeBPS": "50",
      "maxRelayFeeBPS": "500",
      "totalInPoolValue": "1000000000000000000000",
      "totalInPoolValueUsd": "$2,500,000.00",
      "totalDepositsCount": 500,
      "acceptedDepositsCount": 480,
      "pendingDepositsCount": 20,
      "growth24h": 2.5,
      "myPoolAccountsCount": 1
    }
  ]
}
```

**`status`:**

```json
{
  "schemaVersion": "2.0.0",
  "success": true,
  "configExists": true,
  "configDir": "/home/user/.privacy-pools",
  "defaultChain": "mainnet",
  "selectedChain": "mainnet",
  "rpcUrl": "https://...",
  "rpcIsCustom": false,
  "recoveryPhraseSet": true,
  "signerKeySet": true,
  "signerKeyValid": true,
  "signerAddress": "0x...",
  "entrypoint": "0x...",
  "aspHost": "https://...",
  "accountFiles": [{ "chain": "mainnet", "chainId": 1 }],
  "readyForDeposit": true,
  "readyForWithdraw": true,
  "readyForUnsigned": true,
  "recommendedMode": "ready",
  "blockingIssues": [],
  "warnings": [],
  "aspLive": true,
  "rpcLive": true,
  "rpcBlockNumber": "21000000",
  "nextActions": [...]
}
```

**Error response (all commands):**

```json
{
  "schemaVersion": "2.0.0",
  "success": false,
  "errorCode": "RPC_NETWORK_ERROR",
  "errorMessage": "Network error: ...",
  "error": {
    "code": "RPC_NETWORK_ERROR",
    "category": "RPC",
    "message": "Network error: ...",
    "hint": "Check your RPC URL and network connectivity.",
    "retryable": true,
    "nextActions": "[{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] | absent"
  }
}
```

## Preflight Check

Before running wallet-dependent commands, verify setup:

```bash
privacy-pools status --agent
```

Check `recoveryPhraseSet: true`. Most transaction commands also require `signerKeyValid: true` and `readyForDeposit: true`; if `readyForDeposit: false` because the signer is missing or invalid, set `PRIVACY_POOLS_PRIVATE_KEY` in the agent's environment before running transaction commands.

For machine gating, prefer `recommendedMode`, `blockingIssues[]`, and `warnings[]` over inferring from booleans alone. `readyForDeposit`, `readyForWithdraw`, and `readyForUnsigned` remain configuration capability flags, not fund-availability checks. When `recommendedMode = "read-only"`, status detected degraded RPC or ASP health and agents should fall back to the status `nextActions`. That usually means public discovery only; if the ASP is down but RPC is healthy, public recovery (`ragequit`, `flow ragequit`, or unsigned ragequit payloads) still remains available when the affected account or workflow is already known.

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
| `-o, --output <fmt>` | Output format: `table` (default), `csv`, `json` |
| `--jmes <expression>` | Filter JSON output with a JMESPath expression (implies `--json`) |
| `--jq <expression>` | Compatibility alias for `--jmes`; this uses JMESPath, not jq syntax |
| `-y, --yes` | Skip confirmation prompts |
| `-c, --chain <name>` | Target chain (mainnet, arbitrum, optimism, ...) |
| `-r, --rpc-url <url>` | Override RPC URL |
| `-q, --quiet` | Suppress human-oriented stderr output |
| `-v, --verbose` | Enable verbose/debug output |
| `--no-progress` | Suppress spinners/progress indicators (useful in CI) |
| `--no-header` | Suppress header rows in CSV and wide/tabular output |
| `--no-banner` | Disable ASCII banner output. For deterministic output in CI/container environments, use `--no-banner` or `--agent` (which implies `--quiet`, suppressing the banner). The banner uses a session marker in `/tmp` that may not persist across container restarts. |
| `--no-color` | Disable colored output (also respects `NO_COLOR` env var) |
| `--timeout <seconds>` | Network/transaction timeout in seconds (default: 30) |

### CSV Support

CSV output is intentionally limited to listing and read-only reporting commands with tabular data. Write commands do not support CSV because their JSON envelopes carry transaction, proof, and safety metadata that should not be flattened.

| Command | CSV |
| ---- | ---- |
| `pools` | Yes |
| `accounts` | Yes |
| `activity` | Yes |
| `stats` | Yes |
| `history` | Yes |
| `deposit` | No |
| `withdraw` | No |
| `ragequit` | No |
| `flow` | No |
| `init` | No |

## Command Reference

### No Wallet Required

These commands work immediately after install, no `init` or private keys needed.

#### `pools`

List available Privacy Pools. When no `--chain` is specified, defaults to querying all CLI-supported mainnet chains.

```bash
privacy-pools pools --agent
privacy-pools pools --agent --include-testnets
privacy-pools pools --agent --search ETH
privacy-pools pools --agent --sort tvl-desc
privacy-pools pools ETH --agent             # detail view for a specific pool
```

JSON payload (single chain): `{ chain, chainSummaries?: [{ chain, pools, error }], search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, decimals, minimumDeposit, vettingFeeBPS, maxRelayFeeBPS, totalInPoolValue, totalInPoolValueUsd, totalDepositsValue, totalDepositsValueUsd, acceptedDepositsValue, acceptedDepositsValueUsd, pendingDepositsValue, pendingDepositsValueUsd, totalDepositsCount, acceptedDepositsCount, pendingDepositsCount, growth24h, pendingGrowth24h, myPoolAccountsCount? }], warnings?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }`

Default sort is `tvl-desc` (highest pool balance first). Override with `--sort`.

In pools JSON, `asset` is the symbol to use in follow-up CLI commands and `tokenAddress` is the token contract address.

With `--include-testnets`, each pool includes a `chain` field and the root keeps `chain: "all-chains"` plus `chainSummaries: [{ chain, pools, error }]` and optional `warnings`.

**Detail view** (`pools <asset>`): Shows pool stats, your funds (if wallet state can be loaded), and recent activity for a single pool. JSON payload: `{ chain, asset, tokenAddress, pool, scope, ..., myFunds?, myFundsWarning?, recentActivity?, recentActivityUnavailable? }`. `myFunds.balance` is total remaining balance across active Pool Accounts in that pool; private withdrawal still requires `status/aspStatus = "approved"`. When `myFunds` is `null`, `myFundsWarning` may explain why wallet state could not be loaded. `recentActivityUnavailable: true` means the CLI attempted the fetch but could not load it. Supports `--json` and `--chain`. Does not support `--output csv`.

#### `activity`

Public onchain activity feed. When no `--chain` is specified, defaults to querying all CLI-supported mainnet chains.

```bash
privacy-pools activity --agent
privacy-pools activity ETH --agent --limit 20
```

JSON payload (global): `{ mode: "global-activity", chain, chains?, page, perPage, total, totalPages, chainFiltered?, note?, events: [{ type, txHash, explorerUrl, reviewStatus, amountRaw, amountFormatted, poolSymbol, poolAddress, chainId, timestamp }], nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }`

When querying all CLI-supported mainnet chains (no `--chain`), `chain` is `"all-mainnets"` and `chains` lists the chain names queried (e.g. `["mainnet","arbitrum","optimism"]`).

When filtering by `--chain` without a positional asset, events are filtered client-side. In this case `total` and `totalPages` are `null`, `chainFiltered` is `true`, and a `note` field explains the limitation.

With a positional asset (`activity ETH`), mode is `"pool-activity"` and adds `asset`, `pool`, and `scope` fields. Pagination totals are accurate (server-side filtering).

#### `stats global`

Protocol-wide statistics. This is the default subcommand for `stats`. Always shows aggregate cross-chain data. The `--chain` flag is **not** supported for `stats global`; use `stats pool <symbol> --chain <chain>` for chain-specific data.

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
privacy-pools stats pool ETH --agent
```

JSON payload: `{ mode: "pool-stats", chain, asset, pool, scope, cacheTimestamp, allTime, last24h }`

#### `status`

Configuration and health check.

```bash
privacy-pools status --agent
privacy-pools status --agent --check
```

JSON payload: `{ configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, recoveryPhraseSet, signerKeySet, signerKeyValid, signerAddress, signerBalance?, signerBalanceDecimals?, signerBalanceSymbol?, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned, recommendedMode, blockingIssues?: [{ code, message, affects[] }], warnings?: [{ code, message, affects[] }], nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }], aspLive?, rpcLive?, rpcBlockNumber? }`

`readyForDeposit`, `readyForWithdraw`, and `readyForUnsigned` are **configuration capability** flags: they indicate the wallet is set up for those operations, **not** that privately withdrawable funds exist. `recommendedMode`, `blockingIssues[]`, and `warnings[]` are the higher-level preflight contract for agents. To verify fund availability before withdrawing on a specific chain, check `accounts --agent --chain <chain>`. Use bare `accounts --agent` only for the default multi-chain mainnet dashboard. `nextActions` provides the canonical CLI follow-up to run next: it points to `init` when setup is incomplete, to `pools` when no deposits exist, or to `accounts` when deposits already exist. If the recovery phrase is configured but no valid signer key is available, those follow-ups stay read-only while `readyForDeposit` remains `false`. When `recommendedMode = "read-only"` because RPC or ASP health is degraded, `nextActions` stays on public discovery and intentionally avoids account-state guidance until connectivity is restored. If only the ASP is down while RPC is still healthy, public recovery remains available through `ragequit`, `flow ragequit`, or unsigned ragequit payloads when the operator already knows the affected account or workflow. `aspLive`, `rpcLive`, and `rpcBlockNumber` are included by default when a chain is selected (via `--chain` or default chain). Pass `--no-check` to suppress health checks, or use `--check-rpc` / `--check-asp` to run only specific checks.
When `rpcUrl` or `aspHost` comes from a custom endpoint, the CLI redacts userinfo, query strings, and token-like path segments before printing them.

#### `upgrade`

Check npm for updates or upgrade this CLI.

```bash
privacy-pools upgrade --agent --check
privacy-pools upgrade --agent --yes
```

JSON payload: `{ mode: "upgrade", status, currentVersion, latestVersion, updateAvailable, performed, command|null, installContext: { kind, supportedAutoRun, reason }, installedVersion|null, releaseHighlights?: string[], nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }`

`upgrade` checks npm for the latest published `privacy-pools-cli` release. Automatic upgrade is supported only for recognized global npm installs. Source checkouts, non-npm global installs, local project installs, `npx`-style ephemeral runs, CI, and other ambiguous contexts never mutate; they return manual guidance plus an exact follow-up npm command. In machine modes, `upgrade` stays check-only unless `--yes` is also present. A successful upgrade updates the installed CLI on disk but does not hot-reexec the current process, so rerun `privacy-pools` after it completes.

When `status = "manual"`, the JSON payload includes `externalGuidance: { kind, message, command? }` instead of `nextActions` so agents do not loop on a CLI command that cannot complete the upgrade automatically.

#### `capabilities`

Machine-readable discovery manifest.

```bash
privacy-pools capabilities --agent
```

JSON payload: `{ commands[], commandDetails{}, executionRoutes{}, globalFlags[], exitCodes[], envVars[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], protocol{}, runtime{}, safeReadOnlyCommands[], jsonOutputContract, documentation?: { reference, agentGuide, changelog, runtimeUpgrades, jsonContract } }`

`schemas.nextActions` documents the shared canonical shape used by commands that emit machine follow-up guidance. `executionRoutes` is the canonical execution-ownership map. `commandDetails` now also exposes per-command risk metadata and action-discovery metadata: `sideEffectClass`, `touchesFunds`, `requiresHumanReview`, `preferredSafeVariant?`, and `expectedNextActionWhen?`. The `sideEffectClass` values are:

- `read_only` -- Command only reads data, no side effects (e.g., `pools`, `accounts`, `status`)
- `local_cache_write` -- Command refreshes or stores derived local cache/state without changing wallet intent (e.g., `accounts`, `history`)
- `local_state_write` -- Command writes to the local filesystem (e.g., `init`, `sync`)
- `network_write` -- Command submits onchain transactions that do not directly move user funds
- `fund_movement` -- Command may move funds via deposits, withdrawals, or public recoveries (e.g., `deposit`, `withdraw`, `ragequit`)

`exitCodes[]` enumerates the CLI's success/error exit contract and `envVars[]` enumerates the supported environment variables and aliases that affect runtime behavior. `safeReadOnlyCommands` is separate: it only describes wallet-mutating safety, not whether a command runs in JS or native. `protocol` and `runtime` expose the current protocol profile plus bridge/storage compatibility versions for future upgrades. `documentation` points agents to the bundled reference docs and machine-contract artifacts shipped with the CLI package. For a stable package path, use `docs/contracts/cli-json-contract.current.json`; `documentation.jsonContract` may still expose the exact versioned snapshot path for the active schema.

#### `describe`

Describe one command for runtime agent introspection.

```bash
privacy-pools describe withdraw quote --agent
privacy-pools describe stats global --agent
```

JSON payload: `{ mode: "describe-index", commands: [{ command, description, group }] }` when no command path is provided; `{ command, description, group, aliases, usage, flags, globalFlags, requiresInit, expectedLatencyClass, safeReadOnly, expectedNextActionWhen?, sideEffectClass, touchesFunds, requiresHumanReview, preferredSafeVariant?, prerequisites, examples, structuredExamples, jsonFields, jsonVariants, safetyNotes, supportsUnsigned, supportsDryRun, agentWorkflowNotes }` for `describe <command...>`; or `{ path, schema }` for `describe envelope.<path>`.

#### `guide`

Built-in guide topics for agents and humans.

```bash
privacy-pools guide --agent
privacy-pools guide next-actions --agent
privacy-pools guide agents --agent
```

JSON payload: `{ mode: "help", topic?, topics: [{ name, description }], help, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

#### `config`

Inspect or modify local CLI configuration without re-running `init`.

```bash
privacy-pools config list --agent
privacy-pools config get default-chain --agent
privacy-pools config set default-chain arbitrum --agent
privacy-pools config path --agent
privacy-pools config profile list --agent
privacy-pools config profile use trading --agent
```

Representative JSON payloads:

- `config list`: `{ defaultChain, recoveryPhraseSet, signerKeySet, rpcOverrides: { <chainId>: <url> }, configDir, nextActions?: [...] }`
- `config get`: `{ key, value?, set, redacted?, nextActions?: [...] }`
- `config set` / `config unset`: `{ key, updated, changed, removed, summary, nextActions?: [...] }`
- `config path`: `{ configDir, nextActions?: [...] }`
- `config profile list`: `{ profiles, active, nextActions?: [...] }`
- `config profile create`: `{ profile, created, profileDir, nextActions?: [...] }`
- `config profile active`: `{ profile, configDir, nextActions?: [...] }`
- `config profile use`: `{ profile, active, configDir, nextActions?: [...] }`

#### `completion`

Generate or install shell completion.

```bash
privacy-pools completion zsh --agent
privacy-pools completion --install --agent
```

JSON payload: `{ mode, shell, completionScript? | scriptPath?, profilePath?, scriptCreated?, scriptUpdated?, profileCreated?, profileUpdated?, bootstrapProfilePath?, bootstrapProfileCreated?, bootstrapProfileUpdated?, reloadHint?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

#### `tx-status`

Read-only polling surface for commands that returned immediately with `--no-wait`.

```bash
privacy-pools tx-status 123e4567-e89b-12d3-a456-426614174000 --agent
```

JSON payload: `{ operation: "tx-status", submissionId, sourceOperation, sourceCommand, chain, asset?, poolAccountId?, poolAccountNumber?, workflowId?, recipient?, broadcastMode?, broadcastSourceOperation?, createdAt, updatedAt, status: "submitted" | "confirmed" | "reverted", reconciliationRequired, localStateSynced, warningCode?, lastError?, transactions: [{ index, description, txHash, explorerUrl, blockNumber, status }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

### Wallet Required

These commands require `privacy-pools init` to have been run first.

#### `init`

Guided account setup for the local Privacy Pools profile.

```bash
privacy-pools init --agent --default-chain mainnet --show-recovery-phrase
privacy-pools init --agent --default-chain mainnet --backup-file ./privacy-pools-recovery.txt
privacy-pools init --agent --dry-run
privacy-pools init --agent --recovery-phrase-file ./recovery.txt --default-chain mainnet
cat phrase.txt | privacy-pools init --agent --recovery-phrase-stdin --default-chain mainnet
privacy-pools init --agent --signer-only --private-key-file ./signer-key.txt
printf '%s\n' 0x... | privacy-pools init --agent --recovery-phrase-file ./recovery.txt --private-key-stdin --default-chain mainnet
```

JSON payload: `success: { setupMode, readiness, defaultChain, signerKeySet, recoveryPhraseRedacted? | recoveryPhrase?, backupFilePath?, restoreDiscovery?: { status, chainsChecked, foundAccountChains? }, warning?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }; --dry-run: { operation: "init", dryRun: true, effectiveChain, recoveryPhraseSource, signerKeySource, overwriteExisting, overwritePromptRequired, writeTargets[] }`

When `--show-recovery-phrase` is passed (and a new recovery phrase was generated), `recoveryPhrase` contains that recovery phrase. Otherwise `recoveryPhraseRedacted: true` and a `warning` field is included indicating the recovery phrase must be captured. When importing an existing recovery phrase, neither field is present.

Newly generated CLI recovery phrases use 24 words (256-bit entropy). Imported recovery phrases may be either 12 or 24 words.

Human-facing onboarding uses **load** for the existing-account path. Machine fields and internal implementation still use **restore** terminology for precision.

When `init` loads an existing recovery phrase, inspect `restoreDiscovery` and `nextActions` instead of assuming the account is immediately ready to transact. Website-created legacy accounts may still require `migrate status --agent --include-testnets`, while supported deposits may surface directly through `accounts`.

> **CRITICAL**: When generating a new recovery phrase in machine mode, pass `--show-recovery-phrase` or `--backup-file`. The CLI now fails closed if neither capture path is provided. Losing the recovery phrase means losing access to all deposited funds.

> **Agent handoff**: After `init`, agents should have `PRIVACY_POOLS_PRIVATE_KEY` set in their environment before running any transaction commands. See [Preflight Check](#preflight-check).

Use only one secret stdin source per invocation: either `--recovery-phrase-stdin` or `--private-key-stdin`.

Inline `--recovery-phrase` and `--private-key` are still supported as a last resort, but they are intentionally omitted from the primary examples because shell history and process listings can expose them.

Proof commands use bundled checksum-verified circuit artifacts shipped with the CLI. Set `PRIVACY_POOLS_CIRCUITS_DIR` only when you already have a trusted pre-provisioned directory that you want the CLI to use instead.

#### `flow`

Persisted easy-path workflow that compresses the normal deposit -> ASP review -> relayed private withdrawal journey without changing any manual commands.

```bash
privacy-pools flow start 0.1 ETH --to 0xRecipient --agent
privacy-pools flow start 0.1 ETH --to 0xRecipient --dry-run --agent
privacy-pools flow start 0.1 ETH --to 0xRecipient --privacy-delay off --agent
privacy-pools flow start 100 USDC --to 0xRecipient --new-wallet --export-new-wallet ./flow-wallet.txt --agent
privacy-pools flow status latest --agent
privacy-pools flow step latest --agent
privacy-pools flow ragequit latest --agent
privacy-pools flow watch latest                        # human-only wrapper over status + step
privacy-pools flow watch latest --stream-json         # human-only NDJSON phase changes
privacy-pools flow watch latest --privacy-delay aggressive   # updates the saved privacy-delay policy
```

`flow start` performs the public deposit, saves a workflow locally, and targets a later relayed private withdrawal (the relayer submits the withdrawal onchain) from that same Pool Account (the saved deposit lineage) to the saved recipient. The saved workflow always withdraws the full remaining balance of that same Pool Account at execution time.

Creating or advancing a saved flow requires `init`. `flow status` is read-only and works as long as a saved workflow snapshot already exists locally.

Like `deposit`, `flow start` rejects non-round amounts in machine modes because unique amounts can fingerprint the deposit. Use a round amount in agent/non-interactive runs, or switch to interactive mode if you intentionally accept that privacy tradeoff. In interactive mode, omitting `--to` prompts for the saved recipient. A round input can still become a non-round committed balance after the ASP vetting fee is deducted, so `flow start` may still emit an advisory amount-pattern warning for the later full-balance auto-withdrawal.

New workflows default to a balanced post-approval privacy delay before the relayed withdrawal. `off` means no added hold, `balanced` randomizes the hold between 15 and 90 minutes, and `aggressive` randomizes the hold between 2 and 12 hours. Flow JSON includes `privacyDelayRandom` and `privacyDelayRangeSeconds`; the ranges are `[0, 0]` for `off`, `[900, 5400]` for `balanced`, and `[7200, 43200]` for `aggressive`. Pass `--privacy-delay off|balanced|aggressive` to `flow start`, or to human `flow watch`, to update the saved policy later.

With `--new-wallet`, the CLI generates a dedicated workflow wallet for that one flow. Human `flow start --new-wallet` stays attached and waits for the required funding automatically. In `--agent`, `flow start` returns an `awaiting_funding` snapshot with `walletAddress`, `requiredNativeFunding`, and `requiredTokenFunding`; fund that wallet, then continue with `flow status` / `flow step`. ETH workflows require the full ETH target. ERC20 workflows require both the token amount and a native ETH gas reserve in the same wallet. In non-interactive mode, `--export-new-wallet <path>` is required so the generated private key is backed up before the flow begins.

Saved flows persist local state under `~/.privacy-pools/workflows/`. `flow --new-wallet` also stores the per-workflow private key under `~/.privacy-pools/workflow-secrets/` until the workflow completes, public-recovers, or is externally stopped, so `--export-new-wallet` is a backup copy rather than the only stored copy. Dedicated workflow wallets may retain leftover asset balance or gas reserve after paused or terminal states, so check them manually before assuming they are empty.

The saved workflow spends the full remaining Pool Account balance. The recipient receives the net amount after relayer fees and any ERC20 extra-gas funding.

For agents, the canonical primitives are:

- `flow status <workflowId|latest> --agent`: read-only snapshot with `workflowKind`, `phase`, `privacyDelayUntil?`, `lastError?`, `nextPollAfter`, and `nextActions`.
- `flow step <workflowId|latest> --agent`: advance at most one saved-workflow step and return the new snapshot. When nothing actionable is available, it returns the current snapshot unchanged instead of waiting.

`flow watch` remains available for humans only. It is a thin wrapper over repeated `flow status` + `flow step`; `flow watch --agent` and `flow start --watch --agent` are rejected with machine-readable `CLIError`s pointing agents back to `flow status` and `flow step`.

Workflow `phase` values include `awaiting_funding`, `depositing_publicly`, `awaiting_asp`, `approved_waiting_privacy_delay`, `approved_ready_to_withdraw`, `withdrawing`, `completed`, `completed_public_recovery`, `paused_declined`, `paused_poa_required`, and `stopped_external`. Deposit review state from the ASP (the approval service) remains available separately in `aspStatus`. When the Pool Account is approved, human `flow watch` either waits through the saved privacy-delay window or performs the relayed private withdrawal automatically after approval and any configured privacy delay. Passing human `flow watch --privacy-delay ...` updates the saved workflow policy persistently: `off` clears any saved hold immediately, and switching between `balanced` and `aggressive` resamples from the override time. Pass `--stream-json` to human `flow watch` to emit line-delimited `phase_change` events as the workflow advances, followed by the final snapshot as the last JSON line.

If the workflow is `declined`, it pauses and surfaces `flow ragequit` as the canonical public recovery path. If it is `poa_required`, complete Proof of Association externally to continue privately, or use `flow ragequit` to recover publicly instead. If the saved full-balance withdrawal falls below the relayer minimum, the workflow surfaces `flow ragequit` as the required recovery path because saved flows only support relayed private withdrawals. Once the public deposit exists, operators can also choose `flow ragequit` manually instead of waiting, but that remains a manual alternative rather than the default `nextActions` path while the workflow is still progressing normally.

`flow ragequit` performs the public recovery path for a saved workflow. Once the public deposit exists, it remains available as an optional public recovery path until the workflow reaches a terminal state. If the saved full-balance withdrawal can no longer satisfy the relayer minimum, it becomes the required recovery path because the saved flow only supports relayed private withdrawal. For `walletMode = "new_wallet"` it uses the stored workflow wallet key. For `walletMode = "configured"` it must use the original depositor signer that created the saved workflow.

JSON payload: `{ mode: "flow", action: "start" | "watch" | "status" | "step" | "ragequit", workflowId, workflowKind, phase, nextPollAfter|null, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, privacyDelayUntil|null, warnings?: [{ code, category: "privacy"|"recipient", message }], withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, lastError?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

`flow start --dry-run` validates amount, pool metadata, recipient safety, wallet mode, and privacy-delay policy without saving a workflow, generating workflow secrets, writing export files, approving tokens, or submitting a deposit. In non-interactive mode, `--new-wallet --dry-run` also requires `--export-new-wallet <path>` so the equivalent real command's backup path is validated, but the dry-run does not write that file. Dry-run JSON is `{ mode: "flow", action: "start", dryRun: true, chain, asset, depositAmount, recipient, walletMode, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, vettingFee, vettingFeeAmount, vettingFeeBPS, estimatedCommittedValue, estimatedCommitted, feesApply, warnings?, nextActions? }`.

Paused workflow states are successful command results, not CLI errors. `Ctrl-C` during `flow watch` detaches cleanly without deleting the saved workflow. For ERC20 relayed withdrawals inside `flow`, the CLI requests extra gas by default, matching `withdraw`. `warnings` are advisory only and currently cover amount-linkability guidance for full non-round auto-withdrawals, explicit `--privacy-delay off`, and non-interactive recipients not previously seen in the local profile. They are most common on `flow start`, `flow watch`, and `flow status`, but the shared flow envelope can also surface them on `flow ragequit` when the saved snapshot carries a warning or reconciliation advisory. `privacyDelayConfigured = false` means a legacy workflow was normalized to `off` without an explicitly saved policy.

**Flow state machine:**

The `phase` field in the flow JSON payload tracks the workflow through the following state transitions. Agents should use `phase` to determine what action is needed next.

```
                      +-------------------+
                      | awaiting_funding  |  (--new-wallet: waiting for ETH/token deposit)
                      +--------+----------+
                               |
                               v
                      +-------------------+
                      |depositing_publicly|  (public deposit tx pending or unconfirmed)
                      +--------+----------+
                               |
                               v
                      +-------------------+
                      |   awaiting_asp    |  (deposit confirmed, waiting for ASP review)
                      +--------+----------+
                               |
              +----------------+----------------+
              |                |                |
              v                v                v
  +-----------+---+  +---------+-------+  +----+--------------+
  |paused_declined|  |paused_poa_      |  |approved_waiting_  |
  |               |  |required         |  |privacy_delay      |
  +-------+-------+  +--------+--------+  +--------+----------+
          |                    |                    |
          |                    |                    v
          |                    |           +--------+----------+
          |                    |           |approved_ready_    |
          |                    |           |to_withdraw        |
          |                    |           +--------+----------+
          |                    |                    |
          |                    |                    v
          |                    |           +--------+----------+
          |                    |           |    withdrawing    |
          |                    |           +--------+----------+
          |                    |                    |
          v                    v                    v
  +-------+--------------------+--------------------+-------+
  |                    Terminal states                       |
  |  completed  |  completed_public_recovery  |  stopped_   |
  |             |  (via ragequit)             |  external   |
  +---------------------------------------------------------+
```

**Phase descriptions:**

| Phase | Description |
| --- | --- |
| `awaiting_funding` | `--new-wallet` mode: waiting for ETH and/or token funding |
| `depositing_publicly` | Public deposit transaction is pending or being confirmed |
| `awaiting_asp` | Deposit confirmed onchain, waiting for ASP review |
| `approved_waiting_privacy_delay` | ASP approved, waiting through the configured privacy delay |
| `approved_ready_to_withdraw` | Privacy delay complete (or off), ready for relayed withdrawal |
| `withdrawing` | Relayed withdrawal submitted, waiting for confirmation |
| `completed` | Private withdrawal confirmed; terminal |
| `paused_declined` | ASP declined the deposit; use `flow ragequit` to recover publicly |
| `paused_poa_required` | Proof of Association required; complete PoA externally or use `flow ragequit` |
| `completed_public_recovery` | Public recovery (ragequit) confirmed; terminal |
| `stopped_external` | External intervention detected (e.g., funds spent outside this workflow); terminal |

**Pause and recovery paths:**

- `paused_declined` -> `flow ragequit` -> `completed_public_recovery`
- `paused_poa_required` -> complete PoA externally, then `flow status` / `flow step` resumes in agent mode or `flow watch` resumes in human mode, OR `flow ragequit` -> `completed_public_recovery`
- Any non-terminal phase -> `flow ragequit` (optional manual public recovery) -> `completed_public_recovery`
- Any non-terminal phase -> external spend detected -> `stopped_external`

#### `flow step`

Advance a saved workflow by at most one actionable step without waiting. This is the canonical agent-side mutating primitive for saved workflows.

```bash
privacy-pools flow step latest --agent
privacy-pools flow step 123e4567-e89b-12d3-a456-426614174000 --agent
```

`flow step` never sleeps, polls, or retries internally. It either performs one saved-workflow mutation (for example submitting the public deposit, refreshing approval state once, or submitting the relayed withdrawal once) or returns the current snapshot unchanged when no action is available yet. Pair it with `flow status` for external orchestration.

JSON payload: `{ mode: "flow", action: "step", workflowId, workflowKind, phase, nextPollAfter|null, walletMode, walletAddress|null, requiredNativeFunding|null, requiredTokenFunding|null, backupConfirmed?, chain, asset, depositAmount, recipient, poolAccountId|null, poolAccountNumber|null, depositTxHash|null, depositBlockNumber|null, depositExplorerUrl|null, committedValue|null, aspStatus?, privacyDelayProfile, privacyDelayConfigured, privacyDelayRandom, privacyDelayRangeSeconds, privacyDelayUntil|null, warnings?: [{ code, category: "privacy"|"recipient", message }], withdrawTxHash|null, withdrawBlockNumber|null, withdrawExplorerUrl|null, ragequitTxHash|null, ragequitBlockNumber|null, ragequitExplorerUrl|null, lastError?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

#### `deposit`

Deposit ETH or ERC-20 tokens into a Privacy Pool.

```bash
privacy-pools deposit 0.1 ETH --agent
```

JSON payload: `{ operation: "deposit", status: "submitted" | "confirmed", submissionId?, workflowId, txHash, amount, committedValue, estimatedCommitted, vettingFeeBPS?, vettingFeeAmount?, feesApply, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber|null, explorerUrl, reconciliationRequired, localStateSynced, warningCode?, warnings?: [{ code, category, message }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

All numeric values are strings (wei). `committedValue`, `estimatedCommitted`, and `label` may be `null`.

When `status = "submitted"` (for example with `--no-wait`), use `submissionId` with `tx-status` to poll the onchain confirmation separately. `workflowId` is always present and is the durable handle for the follow-on deposit-review workflow that `flow status` inspects through ASP approval, decline, or PoA follow-up.

`nextActions` provides the canonical structured guidance. Submitted deposits point first to `tx-status` and the saved `flow status <workflowId>` handle. Confirmed deposits point at the same saved `workflowId` plus `accounts --agent --chain <chain> --pending-only` while the Pool Account remains pending, then `accounts --agent --chain <chain>` to confirm whether it was approved, declined, or `poa_required` before choosing `withdraw` or `ragequit`. Always preserve the same `--chain` scope for both polling and confirmation. Bare `accounts` only covers the mainnet chains, so testnet deposits would be invisible without `--chain`.

Deposits are reviewed by the ASP before approval. Most deposits are approved within 1 hour, but some may take longer (up to 7 days). An ASP vetting fee is deducted from the deposit amount. Only approved deposits can use `withdraw` (relayed or direct). Declined deposits must `ragequit` publicly to the deposit address.

**Privacy guard**: In machine modes (`--json`, `--agent`, `--yes`, `--dry-run`, `--unsigned`), non-round deposit amounts are rejected by default because they can fingerprint the deposit. Prefer round amounts. Pass `--ignore-unique-amount` only when you intentionally want to bypass that protection.

#### `withdraw`

Withdraw from a Privacy Pool. Relayed by default (recommended for privacy).

```bash
privacy-pools withdraw 0.05 ETH --to 0xRecipient --agent
privacy-pools withdraw 0.05 ETH --to 0xRecipient --pool-account PA-2 --agent
privacy-pools withdraw --all ETH --to 0xRecipient --agent
privacy-pools withdraw 50% ETH --to 0xRecipient --agent
privacy-pools withdraw 0.1 ETH --direct --confirm-direct-withdraw --agent
privacy-pools withdraw 0.05 ETH --to 0xRecipient --no-extra-gas --agent
```

JSON payload (relayed): `{ operation: "withdraw", status: "submitted" | "confirmed", submissionId?, mode: "relayed", txHash, blockNumber|null, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS, relayerHost?, quoteRefreshCount?, extraGas?, extraGasFundAmount?, remainingBalance, rootMatchedAtProofTime?, reconciliationRequired, localStateSynced, warningCode?, warnings?: [{ code, category, message }], anonymitySet?: { eligible, total, percentage }, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

JSON payload (direct): same but `mode: "direct"`, `feeBPS: null`, no `extraGas`, and `privacyCostManifest` replaces relayer metadata. Human output includes a privacy note that direct withdrawals publicly link deposit and withdrawal addresses onchain.

When `status = "submitted"` (for example with `--no-wait`), use `submissionId` with `tx-status` to poll confirmation without resubmitting.

> **Note**: Direct withdrawals (`--direct`) will publicly link your deposit and withdrawal addresses onchain. This cannot be undone. Non-interactive direct submissions and broadcastable unsigned direct payloads require `--confirm-direct-withdraw`; dry-runs do not. ASP approval is still required for both relayed and direct withdrawals. If a deposit is `poa_required`, complete Proof of Association first. If it is declined, use `ragequit` instead.

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

JSON payload: `{ mode: "relayed-quote", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, relayTxCost, extraGas?, extraGasFundAmount?, extraGasTxCost?, isTestnet, anonymitySet?: { eligible, total, percentage }, warnings?: [{ code, category, message }], nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }`

Relayed withdrawals use a fee quote that expires after ~60 seconds. If proof generation takes longer, the CLI will auto-refresh the quote if the fee hasn't changed. If the fee changes, re-run the command to generate a fresh proof. `nextActions` provides the canonical `withdraw` follow-up; check `runnable` because quotes without a recipient produce a template action that still needs `--to`.

#### `ragequit`

Public recovery to the original deposit address. Does not preserve privacy. Use for declined deposits, PoA-blocked accounts, or when the user chooses not to wait for approval. Asset resolution still works when public pool discovery is offline because the CLI falls back to a built-in pool registry.

```bash
privacy-pools ragequit ETH --pool-account PA-1 --agent
```

JSON payload: `{ operation: "ragequit", status: "submitted" | "confirmed", submissionId?, txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber|null, explorerUrl, destinationAddress?, remainingBalance: "0", privacyCostManifest, reconciliationRequired, localStateSynced, warningCode?, warnings?: [{ code, category, message }], advisory?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

When `status = "submitted"` (for example with `--no-wait`), use `submissionId` with `tx-status` to poll confirmation without resubmitting.

#### `accounts`

List Pool Accounts with their approval status and per-pool balance totals.

```bash
privacy-pools accounts --agent
privacy-pools accounts --agent --include-testnets
privacy-pools accounts --agent --summary
privacy-pools accounts --agent --chain <chain> --pending-only
privacy-pools accounts --agent --details
```

When no `--chain` is specified, `accounts` aggregates all CLI-supported mainnet chains by default. Use `--include-testnets` to include testnets.

JSON payload: `{ chain, allChains?, chains?, warnings?, lastSyncTime?, syncSkipped, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash, explorerUrl, chain?, chainId? }], balances: [{ asset, balance, usdValue, poolAccounts, chain?, chainId? }], pendingCount, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`
Supports `--status <status>` for approved/pending/poa_required/declined/unknown/spent/exited filters. `--watch` is human-only and only valid with pending results.

In multi-chain responses, `poolAccountId` remains chain-local, so pair it with `chain` or `chainId` before using it in follow-up commands.

`balances` contains per-pool totals for Pool Accounts with remaining balance. `balance` is the total amount in wei (string). `usdValue` is a formatted USD string (or null if price data is unavailable).

`--summary` JSON payload: `{ chain, allChains?, chains?, warnings?, lastSyncTime?, syncSkipped, pendingCount, approvedCount, poaRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

`--pending-only` JSON payload: `{ chain, allChains?, chains?, warnings?, lastSyncTime?, syncSkipped, accounts, pendingCount, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

**Poll pending approvals**: After depositing, poll `accounts --agent --chain <chain> --pending-only` while the Pool Account remains pending. Because this mode only returns pending accounts, reviewed entries disappear from the response instead of changing in place. Once it disappears, re-run `accounts --agent --chain <chain>` to confirm whether it became `"approved"`, `"declined"`, or `"poa_required"`. Withdraw only after approval; if declined, use `ragequit`; if `poa_required`, complete Proof of Association first. Always preserve the same `--chain` for both polling and confirmation. Bare `accounts` only covers the mainnet chains. `nextActions` on `accounts` are poll-oriented only and appear when pending approvals still exist.

#### `migrate status`

Read-only legacy migration or recovery readiness check on CLI-supported chains.

```bash
privacy-pools migrate status --agent
privacy-pools migrate status --agent --include-testnets
privacy-pools migrate status --agent --chain mainnet
```

`migrate status` rebuilds the legacy account view from the installed SDK, the built-in CLI pool registry for CLI-supported chains, and current onchain events without persisting trusted account state. It reports whether legacy pre-upgrade commitments still need website migration, already appear fully migrated, require website-based public recovery because they were declined, or cannot be classified safely because ASP review data is incomplete. The CLI does **not** submit migration transactions.

Without `--chain`, `migrate status` checks all CLI-supported mainnet chains by default. Use `--include-testnets` to include supported testnets. Like other multi-chain read-only commands, `--rpc-url` is only valid with `--chain <name>`. Review beta or other website-only migration surfaces in the Privacy Pools website.

JSON payload: `{ mode: "migration-status", chain, allChains?, chains?, warnings?, status, requiresMigration, requiresWebsiteRecovery, isFullyMigrated, readinessResolved, submissionSupported: false, requiredChainIds, migratedChainIds, missingChainIds, websiteRecoveryChainIds, unresolvedChainIds, chainReadiness: [{ chain, chainId, status, candidateLegacyCommitments, expectedLegacyCommitments, migratedCommitments, legacyMasterSeedNullifiedCount, hasPostMigrationCommitments, isMigrated, legacySpendableCommitments, upgradedSpendableCommitments, declinedLegacyCommitments, reviewStatusComplete, requiresMigration, requiresWebsiteRecovery, scopes }], externalGuidance?: { kind, message, url }, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

When `readinessResolved` is `false`, treat the result as incomplete and review the account in the Privacy Pools website before acting on it.

#### `history`

Chronological event history.

```bash
privacy-pools history --agent --limit 50
```

JSON payload: `{ chain, lastSyncTime?, syncSkipped, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }], nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

`type` is `"deposit"`, `"migration"`, `"withdrawal"`, or `"ragequit"`.

#### `sync`

Force-sync local account state from onchain events. Most commands auto-sync with a 2-minute freshness TTL, so explicit sync is rarely needed.

```bash
privacy-pools sync --agent
privacy-pools sync ETH --agent
```

JSON payload: `{ chain, syncedPools, syncedSymbols?, availablePoolAccounts, previousAvailablePoolAccounts?, durationMs?, scannedFromBlock?, scannedToBlock?, eventCounts?: { deposits, withdrawals, ragequits, migrations, total }, lastSyncTime?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }`

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
- **Most deposits are approved within 1 hour, but some may take longer (up to 7 days)**
- Once the Pool Account disappears from pending-only results, re-run `accounts --agent --chain <chain>` to confirm whether it is approved, declined, or `poa_required` before choosing `withdraw` or `ragequit`
- Always preserve `--chain`; bare `accounts` only covers the mainnet chains, so testnet deposits are invisible without it

## Crash Recovery

Deposits are not idempotent. If a deposit fails after tx submission (e.g., CLI crashes between onchain confirmation and local state save), run `sync --agent` to detect the onchain deposit before retrying. Running `deposit` again without syncing will create a new deposit.

For withdrawals: if the CLI crashes after proof generation but before relay submission, the proof is lost and must be regenerated. Re-run the withdraw command.

## Unsigned Transaction Mode

For agents that manage their own signing (e.g., custodial wallets, multisigs, MPC signers), `--unsigned` builds ready-to-sign transaction payloads without submitting them.

> **Important:** When using `--unsigned` (default), the output follows the standard JSON envelope format (`{ schemaVersion, success, ... }`). When using `--unsigned tx`, the output is a **raw transaction array** without the envelope wrapper. Agents parsing unsigned output must check which format was requested.

### Envelope format (default)

```bash
privacy-pools deposit 0.1 ETH --unsigned --agent
```

```json
{
  "schemaVersion": "2.0.0",
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
    "from": null,
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
4. Agent either submits signed transactions directly, or adds signedTransactions[] back to the original envelope and calls: privacy-pools broadcast <file|-> --agent
5. Agent calls: privacy-pools accounts --agent --chain <chain> --pending-only  (to verify the deposit landed; preserve chain scope)
```

If you already have your own submission stack, keep using it. `broadcast` is additive and does not change the current `--unsigned` contract.

### Optional first-party broadcast step

For full-envelope workflows, you can return to the CLI after signing:

```bash
privacy-pools broadcast ./signed-envelope.json --agent
cat ./signed-envelope.json | privacy-pools broadcast - --agent
privacy-pools broadcast ./signed-envelope.json --validate-only --agent
```

`broadcast` only accepts the full unsigned envelope JSON. It intentionally rejects the bare raw transaction array from `--unsigned tx` so the CLI can validate the signed transactions against the original preview before submission.

With `--validate-only`, `broadcast` verifies the envelope and signature parity without submitting anything. The success envelope includes `validatedOnly: true`, transaction rows use `status: "validated"`, and `txHash` / `blockNumber` / `explorerUrl` stay `null`.

With `--no-wait`, `broadcast` returns immediately with `submissionId` and `status: "submitted"` rows so agents can poll `tx-status <submissionId> --agent` instead of re-broadcasting the signed envelope.

## Dry-Run Mode

Validate inputs, check balances, and preview transaction details without submitting:

```bash
privacy-pools deposit 0.1 ETH --dry-run --agent
privacy-pools withdraw 0.05 ETH --to 0x... --dry-run --agent
privacy-pools ragequit ETH --pool-account PA-1 --dry-run --agent
```

Dry-run responses include `"dryRun": true` and all validation results.

`simulate` is a thin alias layer for these same previews:

```bash
privacy-pools simulate deposit 0.1 ETH --agent
privacy-pools simulate withdraw 0.05 ETH --to 0x... --agent
privacy-pools simulate ragequit ETH --pool-account PA-1 --agent
```

The output contract is intentionally identical to the matching `--dry-run` command, and `simulate` rejects `--unsigned` so preview and signing workflows stay distinct.

## Error Handling

### Error Reference

| Error Code | Category | Retryable | Typical Cause |
| --- | --- | --- | --- |
| `INPUT_ERROR` | INPUT | No | Invalid flag, missing argument, or bad input value |
| `PROMPT_CANCELLED` | INPUT | No | User cancelled an interactive prompt |
| `RPC_ERROR` | RPC | No | RPC call failure (non-transient) |
| `RPC_NETWORK_ERROR` | RPC | Yes | Network connectivity issue, DNS failure, or timeout |
| `RPC_RATE_LIMITED` | RPC | Yes | RPC provider rate limit (HTTP 429); switch to dedicated RPC with `--rpc-url` |
| `RPC_POOL_RESOLUTION_FAILED` | RPC | Yes | Pool resolution failed because both ASP and RPC are unreachable |
| `ASP_ERROR` | ASP | No | ASP (approval service) request failure |
| `RELAYER_ERROR` | RELAYER | No | Relayer service request failure |
| `PROOF_ERROR` | PROOF | No | Generic proof generation failure |
| `PROOF_GENERATION_FAILED` | PROOF | No | ZK proof could not be generated; stale state or spent account |
| `PROOF_MERKLE_ERROR` | PROOF | Yes | Pool Account commitment not found in Merkle tree; run `sync` first |
| `PROOF_MALFORMED` | PROOF | No | Corrupt or invalid proof data |
| `CONTRACT_NULLIFIER_ALREADY_SPENT` | CONTRACT | No | Pool Account has already been withdrawn |
| `CONTRACT_INCORRECT_ASP_ROOT` | CONTRACT | Yes | Pool state changed since proof generation; regenerate proof |
| `CONTRACT_UNKNOWN_STATE_ROOT` | CONTRACT | Yes | State root is outdated; run `sync` and retry |
| `CONTRACT_CONTEXT_MISMATCH` | CONTRACT | No | Proof context does not match the withdrawal parameters |
| `CONTRACT_INVALID_PROOF` | CONTRACT | No | ZK proof verification failed onchain |
| `CONTRACT_INVALID_PROCESSOOOR` | CONTRACT | No | Withdrawal type mismatch (e.g., used `--direct` when relayed was expected) |
| `CONTRACT_INVALID_COMMITMENT` | CONTRACT | No | Selected Pool Account commitment is no longer in pool state |
| `CONTRACT_PRECOMMITMENT_ALREADY_USED` | CONTRACT | No | Precommitment hash reused; run a new deposit |
| `CONTRACT_ONLY_ORIGINAL_DEPOSITOR` | CONTRACT | No | Wrong signer address for ragequit; must use original depositor |
| `CONTRACT_NOT_YET_RAGEQUITTEABLE` | CONTRACT | Yes | Deposit must be onchain for a minimum period before public recovery |
| `CONTRACT_MAX_TREE_DEPTH_REACHED` | CONTRACT | No | Pool has reached maximum deposit capacity |
| `CONTRACT_NO_ROOTS_AVAILABLE` | CONTRACT | Yes | Pool state not ready for withdrawals; wait for first state root |
| `CONTRACT_MINIMUM_DEPOSIT_AMOUNT` | CONTRACT | No | Deposit amount is below the pool minimum |
| `CONTRACT_INVALID_DEPOSIT_VALUE` | CONTRACT | No | Deposit amount is too large for this pool |
| `CONTRACT_INVALID_WITHDRAWAL_AMOUNT` | CONTRACT | No | Withdrawal amount is invalid for the selected Pool Account |
| `CONTRACT_POOL_NOT_FOUND` | CONTRACT | No | Requested pool is not available on this chain |
| `CONTRACT_POOL_IS_DEAD` | CONTRACT | No | Pool is no longer accepting new activity |
| `CONTRACT_RELAY_FEE_GREATER_THAN_MAX` | CONTRACT | Yes | Relayer fee exceeds pool's configured maximum; request fresh quote |
| `CONTRACT_INVALID_TREE_DEPTH` | CONTRACT | No | Proof inputs do not match pool tree configuration |
| `CONTRACT_NATIVE_ASSET_TRANSFER_FAILED` | CONTRACT | No | Native ETH transfer to destination failed; recipient may not accept ETH |
| `CONTRACT_INSUFFICIENT_FUNDS` | CONTRACT | No | Wallet lacks ETH for deposit amount plus gas fees |
| `CONTRACT_NONCE_ERROR` | CONTRACT | Yes | Transaction nonce conflict; previous tx may be pending or stuck |
| `ACCOUNT_MIGRATION_REQUIRED` | INPUT | No | Legacy pre-upgrade account must be migrated in the website first |
| `ACCOUNT_WEBSITE_RECOVERY_REQUIRED` | INPUT | No | Legacy declined deposits require website-based recovery first |
| `ACCOUNT_MIGRATION_REVIEW_INCOMPLETE` | ASP | Yes | Legacy ASP review data is incomplete; retry when ASP is healthy |
| `ACCOUNT_NOT_APPROVED` | INPUT | No | Deposit is not approved; may be pending, require PoA, or be declined |
| `UNKNOWN_ERROR` | UNKNOWN | No | Unexpected error; try `sync` and retry, or report the issue |

### Exit codes

| Code | Category |
| ---- | -------- |
| 0    | Success  |
| 1    | Unknown  |
| 2    | Input    |
| 3    | RPC      |
| 4    | Setup    |
| 5    | Relayer  |
| 6    | Proof    |
| 7    | Contract |
| 8    | ASP      |

### Retry strategy

When `retryable: true` is present in the error response:

1. For `RPC_NETWORK_ERROR`, `RPC_RATE_LIMITED`, or `RPC_POOL_RESOLUTION_FAILED`: exponential backoff (1s, 2s, 4s), max 3 retries. For rate limits, consider switching to a dedicated RPC with `--rpc-url`.
2. For `CONTRACT_INCORRECT_ASP_ROOT`, `CONTRACT_UNKNOWN_STATE_ROOT`, or `PROOF_MERKLE_ERROR`: run `sync --agent` first, then retry the original command
3. For `CONTRACT_NO_ROOTS_AVAILABLE`, `CONTRACT_NONCE_ERROR`, `CONTRACT_RELAY_FEE_GREATER_THAN_MAX`, or `CONTRACT_NOT_YET_RAGEQUITTEABLE`: wait 30-60s or request a fresh quote, then retry
4. For `ACCOUNT_MIGRATION_REVIEW_INCOMPLETE`: retry when ASP connectivity is healthy, or run `privacy-pools migrate status --agent` and wait for `readinessResolved: true` before acting on this account.

When `retryable: false` (non-retryable):

5. For `ACCOUNT_MIGRATION_REQUIRED`: review the account in the Privacy Pools website first, migrate the legacy account there, then rerun the CLI restore or sync command.
6. For `ACCOUNT_WEBSITE_RECOVERY_REQUIRED`: review the account in the Privacy Pools website first and use the website's recovery flow for declined legacy deposits, then rerun the CLI restore or sync command.
7. For `ACCOUNT_NOT_APPROVED`: suggest running `privacy-pools accounts --agent --chain <chain>` to check `aspStatus`, preserving the same chain scope used for the withdrawal attempt. If `aspStatus` is `pending`, continue polling. If it is `poa_required`, complete Proof of Association first. If it is `declined`, the recovery path is `privacy-pools ragequit <asset> --chain <chain> --pool-account <PA-#>`.

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

For fully dynamic integration, call `capabilities --agent` at startup to receive a machine-readable manifest of all commands, command details, execution routes, exit codes, environment variables, protocol/runtime compatibility metadata, supported chains, and the JSON output contract. Use `describe <command...> --agent` when you need the detailed runtime contract for one command path. This is useful if you cannot read this file at integration time.
