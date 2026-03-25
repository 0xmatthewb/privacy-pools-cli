---
name: privacy-pools-cli
version: 1.6.1
description: >
  Deposit, withdraw, and manage funds in Privacy Pools v1 on Ethereum, Arbitrum,
  and Optimism. Use when the user or agent needs to interact with Privacy Pools:
  browsing pools, running the easy-path flow, depositing, withdrawing, checking
  accounts and balances, building unsigned transaction payloads for external
  signers, or querying on-chain activity.
author: matthewb
permissions:
  - filesystem:read
  - filesystem:write
  - shell:exec
triggers:
  - command: /privacy-pools
  - pattern: privacy pools
  - pattern: privacy pool deposit
  - pattern: privacy pool withdraw
  - pattern: privacy pool accounts
  - pattern: privacy pool ragequit
  - pattern: privacy pool exit
  - pattern: unsigned deposit
  - pattern: unsigned withdraw
  - pattern: compliant withdrawal
---

# Privacy Pools CLI

SDK-powered CLI for [Privacy Pools v1](https://privacypools.com). Compliant, private transactions on Ethereum, Arbitrum, and Optimism.

Install from GitHub: `npm i -g github:0xmatthewb/privacy-pools-cli` or `bun add -g github:0xmatthewb/privacy-pools-cli`. Binary: `privacy-pools`.

## Quick reference

| Action | CLI (agent-friendly) | Notes |
|--------|---------------------|-------|
| Browse pools | `privacy-pools pools --agent` | No wallet needed |
| Global stats | `privacy-pools stats global --agent` | No wallet needed; `--chain` not supported |
| Pool stats | `privacy-pools stats pool --asset ETH --agent` | No wallet needed |
| Activity feed | `privacy-pools activity --agent` | No wallet needed |
| Check status | `privacy-pools status --agent --check` | No wallet needed |
| Discover capabilities | `privacy-pools capabilities --agent` | No wallet needed |
| Describe one command | `privacy-pools describe withdraw quote --agent` | No wallet needed |
| Initialize wallet | `privacy-pools init --agent --default-chain mainnet --show-mnemonic` | One-time setup |
| Start easy flow | `privacy-pools flow start 0.1 ETH --to 0x... --agent` | Deposit now, save later private withdrawal |
| Start easy flow (new wallet) | `privacy-pools flow start 100 USDC --to 0x... --new-wallet --export-new-wallet ./flow-wallet.txt --agent` | Generates a dedicated workflow wallet and waits for token funding plus ETH gas |
| Watch easy flow | `privacy-pools flow watch latest --agent` | Wait for approval and withdraw privately when ready |
| Check easy flow | `privacy-pools flow status latest --agent` | Inspect the saved workflow snapshot |
| Recover easy flow | `privacy-pools flow ragequit latest --agent` | Public recovery for a declined saved workflow |
| Deposit ETH | `privacy-pools deposit 0.1 ETH --agent` | Requires init |
| Deposit (unsigned) | `privacy-pools deposit 0.1 ETH --unsigned --agent` | No signer key needed |
| Check accounts | `privacy-pools accounts --agent` | Dashboard view across all mainnet chains by default |
| Compact account poll | `privacy-pools accounts --agent --summary` | Counts + balances only |
| Pending-only poll | `privacy-pools accounts --agent --chain <chain> --pending-only` | Pending approvals only; preserve --chain |
| Withdraw (relayed) | `privacy-pools withdraw 0.05 ETH --to 0x... --agent` | Requires init |
| Withdraw all | `privacy-pools withdraw --all ETH --to 0x... --agent` | Full PA balance |
| Withdraw (unsigned) | `privacy-pools withdraw 0.05 ETH --to 0x... --unsigned --agent` | No signer key needed |
| Withdrawal quote | `privacy-pools withdraw quote 0.1 ETH --to 0x... --agent` | Fee estimate |
| Pool detail | `privacy-pools pools ETH --agent` | Combined stats + my funds |
| Ragequit (exit alias) | `privacy-pools ragequit ETH --from-pa PA-1 --agent` | Emergency public exit |
| Dry-run | `privacy-pools deposit 0.1 ETH --dry-run --agent` | Validate without submitting |
| Event history | `privacy-pools history --agent` | Requires init |
| Force sync | `privacy-pools sync --agent` | Rarely needed (auto-sync with 2min TTL) |

---

## 1. Agent mode

Pass `--agent` to any command. This is equivalent to `--json --yes --quiet`:

- JSON on **stdout**, nothing on **stderr**
- No confirmation prompts
- No banners or spinners

All commands also accept `--json`, `--yes`, and `--quiet` individually.

---

## 2. JSON output contract (v1.5.0)

Every response when `--json` or `--agent` is set:

```json
{ "schemaVersion": "1.5.0", "success": true, ...payload }
```

Errors:

```json
{
  "schemaVersion": "1.5.0",
  "success": false,
  "errorCode": "INPUT_ERROR",
  "errorMessage": "Unknown chain: foo",
  "error": {
    "code": "INPUT_ERROR",
    "category": "INPUT",
    "message": "Unknown chain: foo",
    "hint": "Available chains: mainnet, arbitrum, optimism, sepolia, op-sepolia",
    "retryable": false
  }
}
```

Parse `success` first. On failure, use `errorCode` for programmatic handling and `error.hint` for remediation. Check `error.retryable` before deciding to retry.

Some success payloads also include optional `nextActions[]` workflow hints in the shape `{ command, reason, when, args?, options?, runnable? }`. Treat `nextActions` as the canonical machine follow-up field. When `runnable` is `false`, the action is a template that needs additional user input before execution.

---

## 3. Unsigned transaction mode

For custodial signers, multisigs, MPC wallets, or agents like Bankr that manage their own keys:

### Envelope format (default)

```bash
privacy-pools deposit 0.1 ETH --unsigned --agent
```

```json
{
  "schemaVersion": "1.5.0",
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

### Raw tx format (signer-compatible)

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

### Unsigned payload fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `to` | string | yes | Target contract address (0x + 40 hex chars) |
| `data` | string | yes | ABI-encoded calldata (0x + hex) |
| `value` | string | yes | Wei as string ("0" or "100000000000000000") |
| `valueHex` | string | tx format only | Wei as hex string |
| `chainId` | number | yes | 1 (Ethereum), 42161 (Arbitrum), 10 (Optimism), 11155111 (Sepolia), 11155420 (OP Sepolia) |
| `from` | string\|null | envelope only | Signer address if known, otherwise `null` |
| `description` | string | yes | Human-readable step description |

Supported on: `deposit`, `withdraw`, `ragequit` (alias: `exit`).

ERC-20 deposits produce two transactions (approve + deposit). Submit them in order.

### Envelope extra fields by operation

- **Deposit**: `operation: "deposit"`, `precommitment`
- **Withdraw (direct)**: `operation: "withdraw"`, `withdrawMode: "direct"`, `recipient`, `selectedCommitmentLabel`, `selectedCommitmentValue`
- **Withdraw (relayed)**: `operation: "withdraw"`, `withdrawMode: "relayed"`, `recipient`, `selectedCommitmentLabel`, `selectedCommitmentValue`, `feeBPS`, `quoteExpiresAt`, `relayerRequest`
- **Ragequit (exit alias)**: `operation: "ragequit"`, `selectedCommitmentLabel`, `selectedCommitmentValue`

---

## 4. Submit to signer

The CLI builds transaction payloads but does **not** sign or submit in `--unsigned` mode. Hand the payload to your signer:

1. **Bankr / custodial agent**: forward the JSON to your signing endpoint, then submit to the network
2. **External wallet (viem, ethers)**: use `sendTransaction({ to, data, value, chainId })` with your signer
3. **Multisig / MPC**: submit each transaction object as a proposal
4. **Hardware wallet**: display the transaction for user approval

After submission, verify the deposit landed:

```bash
privacy-pools accounts --agent --chain <chain> --pending-only  # check for new Pool Account; preserve --chain and follow nextActions from deposit response
```

---

## 5. Dry-run mode

Validate inputs, check balances, and preview transaction details without submitting:

```bash
privacy-pools deposit 0.1 ETH --dry-run --agent
privacy-pools withdraw 0.05 ETH --to 0x... --dry-run --agent
privacy-pools ragequit ETH --from-pa PA-1 --dry-run --agent
```

Responses include `"dryRun": true` and all validation results. Supported on: `deposit`, `withdraw`, `ragequit` (alias: `exit`).

---

## 6. Environment variables

| Variable | Description |
|----------|-------------|
| `PRIVACY_POOLS_PRIVATE_KEY` | Ethereum private key (alternative to init wizard) |
| `PRIVACY_POOLS_HOME` | Override config directory (default: `~/.privacy-pools`) |
| `PRIVACY_POOLS_CONFIG_DIR` | Alias for `PRIVACY_POOLS_HOME` |
| `PP_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PP_RPC_URL_ARBITRUM`) |
| `PP_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PP_ASP_HOST_SEPOLIA`) |
| `PP_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |
| `NO_COLOR` | Disable colored output (same as `--no-color`) |
| `PP_NO_UPDATE_CHECK` | Set to `1` to disable the update-available notification |
| `PRIVACY_POOLS_CIRCUITS_DIR` | Override circuit artifact cache directory (default: `~/.privacy-pools/circuits/v<sdk-version>`) |

The CLI loads `.env` from the config directory (`~/.privacy-pools/.env`), not from the current working directory. RPC URL can also be overridden per-command with `--rpc-url <url>`.

---

## 7. Supported chains

| Chain | ID | Testnet |
|-------|----|---------|
| `mainnet` | 1 | No |
| `arbitrum` | 42161 | No |
| `optimism` | 10 | No |
| `sepolia` | 11155111 | Yes |
| `op-sepolia` | 11155420 | Yes |

Default: `mainnet`. Override with `--chain <name>` or set via `init --default-chain <name>`. Read-only commands (`pools`, `activity`) default to all mainnet chains when no `--chain` is specified. `stats global` always returns cross-chain aggregates and does not accept `--chain`; use `stats pool --asset <symbol> --chain <chain>` for chain-specific data.

---

## 8. Agent workflow

```
1. privacy-pools capabilities --agent                                   # Discover all commands
2. privacy-pools status --agent                                         # Check setup and health
3. privacy-pools init --agent --default-chain mainnet --show-mnemonic   # Initialize (once)
4. privacy-pools flow start 0.1 ETH --to <addr> --agent                 # Easy path: deposit now, save later withdrawal
5. privacy-pools flow watch latest --agent                              # Resume the saved workflow until it reaches a terminal state
6. privacy-pools flow ragequit latest --agent                           # Public recovery if the saved flow is declined
```

The easy-path `flow` command is the preferred happy path for demos and common agent workflows. It performs the normal public deposit, waits for ASP review, and privately withdraws the full remaining balance of that same Pool Account to the saved recipient once approved.

`flow start --new-wallet` is a flow-scoped convenience path, not a general wallet manager. It generates a dedicated wallet for one workflow, requires a backup before continuing, and then waits for funding automatically. ETH flows wait for the full ETH target. ERC20 flows wait for both the token amount and a native ETH gas reserve in the same wallet. In machine mode, `--export-new-wallet <path>` is required so the generated private key is backed up before the flow starts.

Manual path remains available when you need custom Pool Account selection, partial withdrawals, direct withdrawals, unsigned payloads, or dry-runs:

```
1. privacy-pools pools --agent                                          # Browse available pools (check minimumDeposit)
2. privacy-pools deposit 0.1 ETH --agent                                # Deposit (must be >= minimumDeposit)
3. privacy-pools accounts --agent --chain <chain> --pending-only        # Approved entries disappear; confirm with accounts --agent --chain <chain>
4. privacy-pools withdraw 0.1 ETH --to <addr> --agent                   # Withdraw
```

**Before depositing**, check the `minimumDeposit` field from `privacy-pools pools --agent` for the target asset. Deposit amounts below this threshold will be rejected. Minimums are per-pool and may change; always query at runtime rather than hard-coding.

When restoring an existing recovery phrase, sync automatically recovers older Pool Accounts so they remain discoverable.

In machine mode, `init` returns different `nextActions` depending on the path: new-wallet init points to `status --agent --chain <defaultChain>`, while restore/import points to `accounts --agent --all-chains`.

In machine modes, non-round deposit amounts are rejected by default because they can fingerprint the deposit. Prefer round amounts, or pass `--ignore-unique-amount` only when that tradeoff is intentional.

---

## 9. Error handling

See [reference.md](reference.md#error-format) for the full current error table and payload shape.

Exit codes: 0 (success), 1 (unknown), 2 (input), 3 (RPC), 4 (ASP), 5 (relayer), 6 (proof), 7 (contract).

Recommended retry strategy:
- `RPC_NETWORK_ERROR` / `RPC_RATE_LIMITED` / `RPC_POOL_RESOLUTION_FAILED`: exponential backoff (1s, 2s, 4s), max 3 retries. For rate limits, consider switching to a dedicated RPC with `--rpc-url`.
- `CONTRACT_INCORRECT_ASP_ROOT` / `PROOF_MERKLE_ERROR`: run `privacy-pools sync --agent` first, then retry.
- `CONTRACT_NO_ROOTS_AVAILABLE` / `CONTRACT_NONCE_ERROR`: wait 30-60s and retry.
- `ACCOUNT_NOT_APPROVED`: do not retry immediately; run `accounts --agent --chain <chain>` to check `aspStatus`. If it is `pending`, keep polling `accounts --agent --chain <chain> --pending-only`. If it is `poi_required`, complete Proof of Association at tornado.0xbow.io first. If it is `declined`, the manual recovery path is `ragequit` and the saved easy-path recovery is `flow ragequit <workflowId>`.

---

## 10. Security

- The **recovery phrase** is the master secret. Anyone with it can spend all deposited funds. Store it in an encrypted file or secrets manager, never in plain text, logs, or source control.
- When using `--show-mnemonic` during `init`, capture the recovery phrase output programmatically and write it to a secure store. Do not log or display it to end users.
- The config directory (`~/.privacy-pools`) contains key material. Restrict filesystem permissions (`chmod 700`).
- Avoid setting `PRIVACY_POOLS_PRIVATE_KEY` in shared or CI environments where env vars may be logged. Prefer `--private-key-file` with a restricted-access file.
- For non-interactive secret import, prefer `--mnemonic-stdin` or `--private-key-stdin` over process-list-visible flags. Use only one stdin secret source per invocation.
- Agents that call `init --agent --show-mnemonic` should pipe the `recoveryPhrase` field from the JSON response directly to a secrets manager, then discard it from memory.

---

## 11. Global flags

| Flag | Description |
|------|-------------|
| `--agent` | Alias for `--json --yes --quiet` |
| `-j, --json` | Machine-readable JSON on stdout |
| `--format <fmt>` | Output format: `table` (default), `csv`, `json` |
| `-y, --yes` | Skip confirmation prompts |
| `-c, --chain <name>` | Target chain (mainnet, sepolia, ...) |
| `-r, --rpc-url <url>` | Override RPC endpoint |
| `-q, --quiet` | Suppress non-essential stderr |
| `-v, --verbose` | Debug output |
| `--no-banner` | Disable ASCII banner |
| `--no-color` | Disable colored output (also respects `NO_COLOR` env var) |
| `--timeout <seconds>` | Network/transaction timeout (default: 30) |

---

## 12. Additional resources

For the full command reference with JSON payload shapes, see [reference.md](reference.md).

For runtime discovery, call `privacy-pools capabilities --agent` to receive a machine-readable manifest, then `privacy-pools describe <command...> --agent` when you need the detailed runtime contract for one command path.
