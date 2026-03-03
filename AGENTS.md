# Agent Integration Guide

This document is for AI agents, bots, and programmatic consumers of the Privacy Pools CLI. For human users, see `privacy-pools guide`.

> **Skill files**: For Bankr, Claude Code, and other skill-aware agents, see [`skills/privacy-pools-cli/SKILL.md`](skills/privacy-pools-cli/SKILL.md) and [`skills/privacy-pools-cli/reference.md`](skills/privacy-pools-cli/reference.md).

## Quick Start

```bash
# Install
npm i -g github:0xmatthewb/privacy-pools-cli

# Discover capabilities (no wallet needed)
privacy-pools capabilities --agent

# Browse pools (no wallet needed)
privacy-pools pools --agent

# Full workflow
privacy-pools init --agent --default-chain mainnet
privacy-pools deposit 0.1 --asset ETH --agent
privacy-pools accounts --agent   # poll until aspStatus = "approved"
privacy-pools withdraw 0.1 --asset ETH --to 0xRecipient --agent
```

## Core Concepts

**Agent mode**: Pass `--agent` to any command. This is equivalent to `--json --yes --quiet` — machine-readable JSON on stdout, no interactive prompts, no banners or progress text.

**Dual output**: Human-readable text always goes to **stderr**. Structured JSON always goes to **stdout**. In `--agent` mode, stderr is suppressed.

**JSON envelope**: Every response follows the schema:

```
{ "schemaVersion": "1.3.0", "success": true, ...payload }
{ "schemaVersion": "1.3.0", "success": false, "errorCode": "...", "errorMessage": "...", "error": { ... } }
```

Parse `success` first. On failure, read `errorCode` for programmatic handling and `error.hint` for remediation. Check `error.retryable` before deciding to retry.

## Preflight Check

Before running wallet-dependent commands, verify setup:

```bash
privacy-pools status --agent
```

Check `mnemonicSet: true` and `signerKeySet: true`. If `signerKeySet: false`, set `PRIVACY_POOLS_PRIVATE_KEY` in the agent's environment before running transaction commands.

## Human + Agent Workflow

When a human delegates CLI operations to an agent:

1. **Human** runs `privacy-pools init` interactively (securely stores recovery phrase and signer key)
2. **Human** sets `PRIVACY_POOLS_PRIVATE_KEY` env var in the agent's environment
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
| `-q, --quiet` | Suppress non-essential stderr output |
| `-v, --verbose` | Enable verbose/debug output |
| `--no-banner` | Disable ASCII banner output |
| `--no-color` | Disable colored output (also respects `NO_COLOR` env var) |
| `--timeout <seconds>` | Override default timeout for RPC calls |

## Command Reference

### No Wallet Required

These commands work immediately after install — no `init` or private keys needed.

#### `pools`

List available Privacy Pools. When no `--chain` is specified, defaults to querying all mainnets.

```bash
privacy-pools pools --agent
privacy-pools pools --agent --all-chains
privacy-pools pools --agent --search ETH
privacy-pools pools --agent --sort tvl-desc
```

JSON payload (single chain): `{ chain, search, sort, pools: [{ symbol, asset, pool, scope, decimals, minimumDeposit, vettingFeeBPS, maxRelayFeeBPS, totalInPoolValue, totalInPoolValueUsd, totalDepositsValue, totalDepositsValueUsd, acceptedDepositsValue, acceptedDepositsValueUsd, pendingDepositsValue, pendingDepositsValueUsd, totalDepositsCount, acceptedDepositsCount, pendingDepositsCount, growth24h, pendingGrowth24h }] }`

With `--all-chains`, each pool includes a `chain` field and the root includes `allChains: true`, `chains: [{ chain, pools, error }]`, and optional `warnings`.

#### `activity`

Public onchain activity feed. When no `--chain` is specified, defaults to querying all mainnets.

```bash
privacy-pools activity --agent
privacy-pools activity --agent --asset ETH --limit 20
```

JSON payload (global): `{ mode: "global-activity", chain, page, perPage, total, totalPages, events: [{ type, txHash, reviewStatus, amountRaw, poolSymbol, poolAddress, chainId, timestamp }] }`

With `--asset`, mode is `"pool-activity"` and adds `asset`, `pool`, and `scope` fields.

#### `stats global`

Protocol-wide statistics. This is the default subcommand for `stats`. When no `--chain` is specified, defaults to querying all mainnets.

```bash
privacy-pools stats global --agent
privacy-pools stats --agent  # same as above
```

JSON payload: `{ mode: "global-stats", chain, cacheTimestamp, allTime, last24h }`

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

JSON payload: `{ configExists, configDir, defaultChain, selectedChain, rpcUrl, rpcIsCustom, mnemonicSet, signerKeySet, signerKeyValid, signerAddress, entrypoint, aspHost, accountFiles: [{ chain, chainId }], readyForDeposit, readyForWithdraw, readyForUnsigned }`

`readyForDeposit`, `readyForWithdraw`, and `readyForUnsigned` are convenience booleans agents can check before transacting. `aspLive`, `rpcLive`, and `rpcBlockNumber` are included by default when a chain is selected (via `--chain` or default chain). Pass `--no-check` to suppress health checks, or use `--check-rpc` / `--check-asp` to run only specific checks.

#### `capabilities`

Machine-readable discovery manifest.

```bash
privacy-pools capabilities --agent
```

JSON payload: `{ commands[], globalFlags[], agentWorkflow[], agentNotes{}, schemas{}, supportedChains[], jsonOutputContract }`

### Wallet Required

These commands require `privacy-pools init` to have been run first.

#### `init`

Initialize wallet and configuration.

```bash
privacy-pools init --agent --default-chain mainnet
privacy-pools init --agent --mnemonic "word1 word2 ..." --default-chain sepolia
privacy-pools init --agent --private-key 0x... --default-chain mainnet
```

JSON payload: `{ defaultChain, signerKeySet, mnemonicRedacted? | mnemonic?, warning? }`

When `--show-mnemonic` is passed (and mnemonic was generated), `mnemonic` contains the phrase. Otherwise `mnemonicRedacted: true` and a `warning` field is included indicating the mnemonic must be captured. When importing an existing mnemonic, neither field is present.

> **CRITICAL**: When generating a new mnemonic, always pass `--show-mnemonic` to capture it in JSON output. Without this flag, the mnemonic is stored on disk but not returned — you cannot retrieve it later via the CLI. Losing the mnemonic means losing access to all deposited funds.

> **Agent handoff**: After `init`, agents should have `PRIVACY_POOLS_PRIVATE_KEY` set in their environment before running any transaction commands. See [Preflight Check](#preflight-check).

Circuit artifacts are downloaded automatically on first proof generation (~60s one-time).

#### `deposit`

Deposit ETH or ERC-20 tokens into a Privacy Pool.

```bash
privacy-pools deposit 0.1 --asset ETH --agent
privacy-pools deposit ETH 0.1 --agent --chain sepolia
```

JSON payload: `{ operation: "deposit", txHash, amount, committedValue, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber, explorerUrl, nextStep }`

All numeric values are strings (wei). `committedValue` and `label` may be `null`.

`nextStep` provides guidance: poll `accounts --agent` until `aspStatus = approved` (most deposits approve within 1 hour).

#### `withdraw`

Withdraw from a Privacy Pool. Relayed by default (recommended for privacy).

```bash
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient --agent
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient --from-pa PA-2 --agent
privacy-pools withdraw 0.1 --asset ETH --direct --agent
```

JSON payload (relayed): `{ operation: "withdraw", mode: "relayed", txHash, blockNumber, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS }`

JSON payload (direct): same but `mode: "direct"`, `fee: null`, no `feeBPS`.

> **Note**: Direct withdrawals (`--direct`) are not privacy-preserving. Use relayed mode (default) for private withdrawals.

**Withdrawal quote:**

```bash
privacy-pools withdraw quote 0.1 --asset ETH --to 0xRecipient --agent
```

JSON payload: `{ mode: "relayed-quote", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, maxRelayFeeBPS, quoteFeeBPS, feeCommitmentPresent, quoteExpiresAt }`

Relayed withdrawals use a fee quote that expires after ~60 seconds. If proof generation takes longer, the CLI will auto-refresh the quote if the fee hasn't changed. If the fee changes, re-run the command to generate a fresh proof.

#### `ragequit`

Emergency withdrawal without ASP approval. Reveals the deposit address onchain — no privacy is gained.

```bash
privacy-pools ragequit --asset ETH --from-pa PA-1 --agent
```

JSON payload: `{ operation: "ragequit", txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber, explorerUrl }`

#### `accounts`

List Pool Accounts with their approval status and per-pool balance totals.

```bash
privacy-pools accounts --agent
privacy-pools accounts --agent --all --details
```

JSON payload: `{ chain, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash }], balances: [{ asset, balance, usdValue, poolAccounts }], pendingCount }`

`balances` contains per-pool totals for spendable accounts. `balance` is total spendable amount in wei (string). `usdValue` is a formatted USD string (or null if price data is unavailable).

**Poll `aspStatus`**: After depositing, poll `accounts --agent` until `aspStatus` changes from `"pending"` to `"approved"`. Only approved accounts can be withdrawn via the relayed path.

#### `history`

Chronological event history.

```bash
privacy-pools history --agent --limit 50
```

JSON payload: `{ chain, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }] }`

`type` is `"deposit"`, `"withdrawal"`, or `"ragequit"`.

#### `sync`

Force-sync local account state from onchain events. Hidden from `--help` but always accessible. Most commands auto-sync with a 2-minute freshness TTL, so explicit sync is rarely needed.

```bash
privacy-pools sync --agent
privacy-pools sync --agent --asset ETH
```

JSON payload: `{ chain, syncedPools, syncedSymbols, spendableCommitments }`

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

After depositing, poll `accounts --agent` for `aspStatus` changes:

- **Initial interval**: 60 seconds
- **Backoff**: exponential, max 5 minutes between polls
- **Most deposits approve within 1 hour**
- **Maximum wait**: 7 days (rare edge cases)
- Once `aspStatus = "approved"`, proceed with withdrawal

## Crash Recovery

Deposits are not idempotent. If a deposit fails after tx submission (e.g., CLI crashes between onchain confirmation and local state save), run `sync --agent` to detect the onchain deposit before retrying. Running `deposit` again without syncing will create a new deposit.

For withdrawals: if the CLI crashes after proof generation but before relay submission, the proof is lost and must be regenerated. Re-run the withdraw command.

## Unsigned Transaction Mode

For agents that manage their own signing (e.g., custodial wallets, multisigs, MPC signers), `--unsigned` builds ready-to-sign transaction payloads without submitting them.

### Envelope format (default)

```bash
privacy-pools deposit 0.1 --asset ETH --unsigned --agent
```

```json
{
  "schemaVersion": "1.3.0",
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
privacy-pools deposit 0.1 --asset ETH --unsigned --unsigned-format tx --agent
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
1. Agent calls: privacy-pools deposit 0.1 --asset ETH --unsigned --agent
2. Agent receives transactions[] array
3. Agent signs each transaction with its own key
4. Agent submits signed transactions to the network
5. Agent calls: privacy-pools accounts --agent  (to verify deposit landed)
```

## Dry-Run Mode

Validate inputs, check balances, and preview transaction details without submitting:

```bash
privacy-pools deposit 0.1 --asset ETH --dry-run --agent
privacy-pools withdraw 0.05 --asset ETH --to 0x... --dry-run --agent
privacy-pools ragequit --asset ETH --from-pa PA-1 --dry-run --agent
```

Dry-run responses include `"dryRun": true` and all validation results.

## Error Handling

### Error codes

| Code                                 | Category | Retryable | Meaning                                    |
| ------------------------------------ | -------- | --------- | ------------------------------------------ |
| `INPUT_ERROR`                        | INPUT    | No        | Bad arguments, missing flags               |
| `RPC_ERROR`                          | RPC      | No        | RPC call failure                            |
| `RPC_NETWORK_ERROR`                  | RPC      | Yes       | Network connectivity issue                  |
| `ASP_ERROR`                          | ASP      | No        | ASP service failure                         |
| `RELAYER_ERROR`                      | RELAYER  | No        | Relayer request failure                     |
| `PROOF_ERROR`                        | PROOF    | No        | Proof generation failure                    |
| `PROOF_GENERATION_FAILED`            | PROOF    | No        | ZK proof could not be generated             |
| `PROOF_MERKLE_ERROR`                 | PROOF    | Yes       | Commitment not in Merkle tree (sync first)  |
| `PROOF_MALFORMED`                    | PROOF    | No        | Corrupt proof data                          |
| `CONTRACT_NULLIFIER_ALREADY_SPENT`   | CONTRACT | No        | Pool Account already withdrawn              |
| `CONTRACT_INCORRECT_ASP_ROOT`        | CONTRACT | Yes       | State changed, regenerate proof             |
| `CONTRACT_INVALID_PROOF`             | CONTRACT | No        | Proof rejected onchain                      |
| `CONTRACT_INVALID_PROCESSOOOR`       | CONTRACT | No        | Wrong withdrawal mode                       |
| `CONTRACT_PRECOMMITMENT_ALREADY_USED`| CONTRACT | No        | Duplicate precommitment, retry deposit      |
| `CONTRACT_ONLY_ORIGINAL_DEPOSITOR`   | CONTRACT | No        | Wrong signer for ragequit                   |
| `CONTRACT_NO_ROOTS_AVAILABLE`        | CONTRACT | Yes       | Pool not ready, wait and retry              |
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

1. For `RPC_NETWORK_ERROR`: exponential backoff (1s, 2s, 4s), max 3 retries
2. For `CONTRACT_INCORRECT_ASP_ROOT` or `PROOF_MERKLE_ERROR`: run `sync --agent` first, then retry the original command
3. For `CONTRACT_NO_ROOTS_AVAILABLE`: wait 30-60s and retry

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

For fully dynamic integration, call `capabilities --agent` at startup to receive a machine-readable manifest of all commands, flags, workflow steps, supported chains, and the JSON output contract. This is useful if you cannot read this file at integration time.
