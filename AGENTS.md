# Agent Integration Guide

This document is for AI agents, bots, and programmatic consumers of the Privacy Pools CLI. For human users, see `privacy-pools guide`.

> **Skill files**: For Bankr, Claude Code, and other skill-aware agents, see [`skills/privacy-pools-cli/SKILL.md`](skills/privacy-pools-cli/SKILL.md) and [`skills/privacy-pools-cli/reference.md`](skills/privacy-pools-cli/reference.md).

## Quick Start

```bash
# Install
npm install -g privacy-pools-cli

# Discover capabilities (no wallet needed)
privacy-pools capabilities --agent

# Browse pools (no wallet needed)
privacy-pools pools --agent

# Full workflow
privacy-pools init --agent --default-chain ethereum --skip-circuits
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

## Command Reference

### No Wallet Required

These commands work immediately after install — no `init` or private keys needed.

#### `pools`

List available Privacy Pools.

```bash
privacy-pools pools --agent
privacy-pools pools --agent --all-chains
privacy-pools pools --agent --search ETH
privacy-pools pools --agent --sort tvl
```

JSON payload (single chain): `{ chain, search, sort, pools: [{ symbol, asset, pool, scope, minimumDeposit, vettingFeeBPS, maxRelayFeeBPS, totalInPoolValue, totalInPoolValueUsd, totalDepositsValue, totalDepositsValueUsd, acceptedDepositsValue, acceptedDepositsValueUsd, pendingDepositsValue, pendingDepositsValueUsd, totalDepositsCount, acceptedDepositsCount, pendingDepositsCount, growth24h, pendingGrowth24h }] }`

With `--all-chains`, each pool includes a `chain` field and the root includes `allChains: true`, `chains: [{ chain, pools, error }]`, and optional `warnings`.

#### `activity`

Public on-chain activity feed.

```bash
privacy-pools activity --agent
privacy-pools activity --agent --asset ETH --limit 20
```

JSON payload (global): `{ mode: "global-activity", chain, page, perPage, total, totalPages, events: [{ type, txHash, reviewStatus, amountRaw, poolSymbol, poolAddress, chainId, timestamp }] }`

With `--asset`, mode is `"pool-activity"` and adds `asset`, `pool`, and `scope` fields.

#### `stats global`

Protocol-wide statistics.

```bash
privacy-pools stats global --agent
```

JSON payload: `{ mode: "global-stats", chain, cacheTimestamp, allTime, last24h }`

`allTime` and `last24h` are ASP-provided objects containing fields like `tvlUsd`, `avgDepositSizeUsd`, `totalDepositsCount`, `totalWithdrawalsCount`.

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

JSON payload: `{ configExists, configDir, defaultChain, selectedChain, rpcUrl, mnemonicSet, signerKeySet, signerKeyValid, signerAddress, entrypoint, aspHost, accountFiles: [{ chain, chainId }] }`

`aspLive`, `rpcLive`, and `rpcBlockNumber` are only present when `--check`, `--check-rpc`, or `--check-asp` is passed.

#### `capabilities`

Machine-readable discovery manifest.

```bash
privacy-pools capabilities --agent
```

JSON payload: `{ commands[], globalFlags[], agentWorkflow[], jsonOutputContract }`

### Wallet Required

These commands require `privacy-pools init` to have been run first.

#### `init`

Initialize wallet and configuration.

```bash
privacy-pools init --agent --default-chain ethereum --skip-circuits
privacy-pools init --agent --mnemonic "word1 word2 ..." --default-chain sepolia
privacy-pools init --agent --private-key 0x... --default-chain ethereum
```

JSON payload: `{ defaultChain, signerKeySet, mnemonicRedacted? | mnemonic? }`

When `--show-mnemonic` is passed (and mnemonic was generated), `mnemonic` contains the phrase. Otherwise `mnemonicRedacted: true`. When importing an existing mnemonic, neither field is present.

`--skip-circuits` skips local circuit downloads. Recommended for agents.

#### `deposit`

Deposit ETH or ERC-20 tokens into a Privacy Pool.

```bash
privacy-pools deposit 0.1 --asset ETH --agent
privacy-pools deposit ETH 0.1 --agent --chain sepolia
```

JSON payload: `{ operation: "deposit", txHash, amount, committedValue, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, label, blockNumber, explorerUrl }`

All numeric values are strings (wei). `committedValue` and `label` may be `null`.

#### `withdraw`

Withdraw from a Privacy Pool. Relayed by default.

```bash
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient --agent
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient --from-pa PA-2 --agent
privacy-pools withdraw 0.1 --asset ETH --direct --agent
```

JSON payload (relayed): `{ operation: "withdraw", mode: "relayed", txHash, blockNumber, amount, recipient, explorerUrl, poolAddress, scope, asset, chain, poolAccountNumber, poolAccountId, feeBPS }`

JSON payload (direct): same but `mode: "direct"`, `fee: null`, no `feeBPS`.

**Withdrawal quote:**

```bash
privacy-pools withdraw quote 0.1 --asset ETH --to 0xRecipient --agent
```

JSON payload: `{ mode: "relayed-quote", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, maxRelayFeeBPS, quoteFeeBPS, feeCommitmentPresent, quoteExpiresAt }`

#### `ragequit`

Emergency withdrawal without ASP approval. Reveals the deposit address on-chain.

```bash
privacy-pools ragequit --asset ETH --from-pa PA-1 --agent
```

JSON payload: `{ operation: "ragequit", txHash, amount, asset, chain, poolAccountNumber, poolAccountId, poolAddress, scope, blockNumber, explorerUrl }`

#### `balance`

Show balances across all pools.

```bash
privacy-pools balance --agent
```

JSON payload: `{ chain, balances: [{ asset, assetAddress, balance, commitments, poolAccounts }] }`

`balance` is total spendable balance in wei (string). `commitments` and `poolAccounts` are counts.

#### `accounts`

List Pool Accounts with their approval status.

```bash
privacy-pools accounts --agent
privacy-pools accounts --agent --all --details
```

JSON payload: `{ chain, accounts: [{ poolAccountNumber, poolAccountId, status, aspStatus, asset, scope, value, hash, label, blockNumber, txHash }] }`

**Poll `aspStatus`**: After depositing, poll `accounts --agent` until `aspStatus` changes from `"pending"` to `"approved"`. Only approved accounts can be withdrawn via the relayed path.

#### `history`

Chronological event history.

```bash
privacy-pools history --agent --limit 50
```

JSON payload: `{ chain, events: [{ type, asset, poolAddress, poolAccountNumber, poolAccountId, value, blockNumber, txHash, explorerUrl }] }`

`type` is `"deposit"`, `"withdrawal"`, or `"ragequit"`.

#### `sync`

Resync local account state from on-chain events.

```bash
privacy-pools sync --agent
privacy-pools sync --agent --asset ETH
```

JSON payload: `{ chain, syncedPools, syncedSymbols, spendableCommitments }`

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
  "chain": "ethereum",
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
| `CONTRACT_INVALID_PROOF`             | CONTRACT | No        | Proof rejected on-chain                     |
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
| `ethereum`   | 1          | No      | Default chain, largest pools    |
| `arbitrum`   | 42161      | No      | Lower gas costs                 |
| `optimism`   | 10         | No      | Lower gas costs                 |
| `sepolia`    | 11155111   | Yes     | For testing                     |
| `op-sepolia` | 11155420   | Yes     | For testing (OP Stack)          |

Specify with `--chain <name>` or set a default via `init --default-chain <name>`.

## Runtime Discovery

For fully dynamic integration, call `capabilities --agent` at startup to receive a machine-readable manifest of all commands, flags, workflow steps, and the JSON output contract. This is useful if you cannot read this file at integration time.
