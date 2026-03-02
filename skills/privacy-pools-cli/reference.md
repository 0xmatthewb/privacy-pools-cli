# Privacy Pools CLI Reference

Detailed payload spec, JSON output shapes, and unsigned transaction format for agent integration.

## Unsigned payload spec

All `--unsigned` output targets the chain specified by `--chain` (default: `mainnet`, chain ID 1).

### Payload shape (envelope format)

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

### Payload shape (raw tx format)

With `--unsigned-format tx`, output is a bare array of transaction objects:

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

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | yes | Target contract address (`0x` + 40 hex chars) |
| `data` | `string` | yes | ABI-encoded calldata (`0x` + hex) |
| `value` | `string` | yes | ETH amount in wei as a **string** (e.g. `"0"`, `"100000000000000000"`) |
| `valueHex` | `string` | tx format only | Wei as hex string (e.g. `"0x16345785d8a0000"`) |
| `chainId` | `number` | yes | Target chain ID |
| `from` | `string\|null` | envelope only | Signer address if known, otherwise `null` |
| `description` | `string` | yes | Human-readable step description (informational) |

`value` must always be a **string**, never a number or bigint.

### Envelope extra fields

The envelope format includes additional context fields depending on the operation:

**Deposit:**
- `operation`: `"deposit"`
- `precommitment`: commitment hash as decimal string

**Withdraw (direct):**
- `operation`: `"withdraw"`
- `withdrawMode`: `"direct"`
- `recipient`: recipient address
- `selectedCommitmentLabel`, `selectedCommitmentValue`: commitment details as decimal strings

**Withdraw (relayed):**
- `operation`: `"withdraw"`
- `withdrawMode`: `"relayed"`
- `recipient`: recipient address
- `selectedCommitmentLabel`, `selectedCommitmentValue`: commitment details as decimal strings
- `feeBPS`: relayer fee in basis points (string)
- `quoteExpiresAt`: ISO timestamp for quote expiry
- `relayerRequest`: full relayer request payload (for submission)

**Ragequit:**
- `operation`: `"ragequit"`
- `selectedCommitmentLabel`, `selectedCommitmentValue`: commitment details as decimal strings

---

## JSON output shapes by command

All responses include `{ "schemaVersion": "1.3.0", "success": true, ... }` envelope.

### `pools`

```bash
pp pools --agent [--all-chains] [--search <query>] [--sort <mode>]
```

Defaults to all mainnets when no `--chain` is specified.

**Single chain** (with `--chain`):

```json
{
  "chain": "mainnet",
  "search": null,
  "sort": "default",
  "pools": [
    {
      "symbol": "ETH",
      "asset": "0xEeee...EEeE",
      "pool": "0x...",
      "scope": "123...",
      "minimumDeposit": "10000000000000000",
      "vettingFeeBPS": "50",
      "maxRelayFeeBPS": "50",
      "totalInPoolValue": "125500000000000000000",
      "totalInPoolValueUsd": "250000",
      "totalDepositsValue": "500000000000000000000",
      "totalDepositsValueUsd": "1000000",
      "acceptedDepositsValue": "450000000000000000000",
      "acceptedDepositsValueUsd": "900000",
      "pendingDepositsValue": "50000000000000000000",
      "pendingDepositsValueUsd": "100000",
      "totalDepositsCount": 42,
      "acceptedDepositsCount": 40,
      "pendingDepositsCount": 2,
      "growth24h": "5.2",
      "pendingGrowth24h": "1.1"
    }
  ]
}
```

**All chains** (`--all-chains`): each pool includes a `chain` field and root includes:

```json
{
  "allChains": true,
  "search": null,
  "sort": "default",
  "chains": [{ "chain": "mainnet", "pools": 2, "error": null }],
  "pools": [ ... ],
  "warnings": [{ "chain": "sepolia", "category": "ASP", "message": "..." }]
}
```

All numeric token amounts are in wei (strings). USD values, counts, and growth rates are nullable.

### `activity`

```bash
pp activity --agent [--asset <symbol>] [--limit <n>] [--page <n>]
```

Defaults to all mainnets when no `--chain` is specified.

**Global:**

```json
{
  "mode": "global-activity",
  "chain": "mainnet",
  "page": 1,
  "perPage": 12,
  "total": 100,
  "totalPages": 9,
  "events": [
    {
      "type": "deposit",
      "txHash": "0x...",
      "reviewStatus": "approved",
      "amountRaw": "100000000000000000",
      "poolSymbol": "ETH",
      "poolAddress": "0x...",
      "chainId": 1,
      "timestamp": 1700000000000
    }
  ]
}
```

**Per-pool** (`--asset`): `mode` is `"pool-activity"` and root includes `asset`, `pool`, and `scope`.

`timestamp` is milliseconds since epoch (number or null). `total` and `totalPages` may be null.

### `stats global`

```bash
pp stats global --agent
```

Defaults to all mainnets when no `--chain` is specified.

```json
{
  "mode": "global-stats",
  "chain": "mainnet",
  "cacheTimestamp": "2025-01-15T12:00:00Z",
  "allTime": {
    "tvlUsd": "1000000",
    "avgDepositSizeUsd": "500",
    "totalDepositsCount": 2000,
    "totalWithdrawalsCount": 1500
  },
  "last24h": {
    "tvlUsd": "1000000",
    "avgDepositSizeUsd": "600",
    "totalDepositsCount": 15,
    "totalWithdrawalsCount": 8
  }
}
```

`cacheTimestamp`, `allTime`, and `last24h` may be null. The `allTime`/`last24h` objects come from the ASP service and may contain additional fields.

### `stats pool`

```bash
pp stats pool --asset ETH --agent
```

```json
{
  "mode": "pool-stats",
  "chain": "mainnet",
  "asset": "ETH",
  "pool": "0x...",
  "scope": "123...",
  "cacheTimestamp": "2025-01-15T12:00:00Z",
  "allTime": { "tvlUsd": "500000", "avgDepositSizeUsd": "500", "totalDepositsCount": 1000, "totalWithdrawalsCount": 750 },
  "last24h": { "tvlUsd": "500000", "avgDepositSizeUsd": "600", "totalDepositsCount": 10, "totalWithdrawalsCount": 5 }
}
```

### `status`

```bash
pp status --agent [--check] [--check-rpc] [--check-asp]
```

```json
{
  "configExists": true,
  "configDir": "/home/user/.privacy-pools",
  "defaultChain": "mainnet",
  "selectedChain": "mainnet",
  "rpcUrl": "https://...",
  "mnemonicSet": true,
  "signerKeySet": true,
  "signerKeyValid": true,
  "signerAddress": "0x...",
  "entrypoint": "0x6818809eefce719e480a7526d76bd3e561526b46",
  "aspHost": "https://api.0xbow.io",
  "accountFiles": [{ "chain": "mainnet", "chainId": 1 }],
  "readyForDeposit": true,
  "readyForWithdraw": true,
  "readyForUnsigned": true
}
```

When health checks are run (`--check`, `--check-rpc`, `--check-asp`), additional fields appear:

| Field | Type | When present |
|-------|------|-------------|
| `aspLive` | boolean | `--check` or `--check-asp` |
| `rpcLive` | boolean | `--check` or `--check-rpc` |
| `rpcBlockNumber` | string | `--check` or `--check-rpc` (when RPC is live) |

### `capabilities`

```bash
pp capabilities --agent
```

```json
{
  "commands": [
    {
      "name": "deposit",
      "description": "Deposit ETH or ERC-20 tokens into a Privacy Pool",
      "flags": ["--asset <symbol|address>", "--unsigned", "--unsigned-format <envelope|tx>", "--dry-run"],
      "agentFlags": "--json --yes",
      "requiresInit": true
    }
  ],
  "globalFlags": [
    { "flag": "--agent", "description": "Alias for --json --yes --quiet" }
  ],
  "agentWorkflow": [
    "1. privacy-pools init --json --yes --default-chain <chain>",
    "2. privacy-pools pools --json --chain <chain>",
    "3. privacy-pools deposit <amount> --asset <symbol> --json --yes --chain <chain>",
    "4. privacy-pools accounts --json --chain <chain>  (wait for aspStatus: approved)",
    "5. privacy-pools withdraw <amount> --asset <symbol> --to <address> --json --yes --chain <chain>"
  ],
  "agentNotes": {
    "polling": "After depositing, poll 'accounts --json' ...",
    "withdrawQuote": "Use 'withdraw quote' to check fees ...",
    "firstRun": "First proof downloads circuits (~60s) ...",
    "unsignedMode": "--unsigned builds tx payloads without signing ...",
    "metaFlag": "--agent is equivalent to --json --yes --quiet ...",
    "statusCheck": "Run 'status --json' before transacting. Check readyForDeposit/readyForWithdraw/readyForUnsigned."
  },
  "schemas": {
    "aspApprovalStatus": { "values": ["approved", "pending", "unknown"] },
    "poolAccountStatus": { "values": ["spendable", "spent", "exited"] },
    "errorCategories": { "values": ["INPUT", "RPC", "ASP", "RELAYER", "PROOF", "CONTRACT", "UNKNOWN"] }
  },
  "jsonOutputContract": "All commands emit { schemaVersion, success, ...payload } on stdout when --json is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage }."
}
```

### `init`

```bash
pp init --agent --default-chain mainnet
pp init --agent --mnemonic "word1 word2 ..." --default-chain sepolia
pp init --agent --private-key 0x... --default-chain mainnet
pp init --agent --private-key-file ./key.txt --default-chain mainnet
```

```json
{
  "defaultChain": "mainnet",
  "signerKeySet": true,
  "mnemonicRedacted": true
}
```

| Field | Type | Notes |
|-------|------|-------|
| `defaultChain` | string | The chain set during init |
| `signerKeySet` | boolean | Whether a signer key was configured |
| `mnemonic` | string | Only when `--show-mnemonic` and mnemonic was generated (not imported) |
| `mnemonicRedacted` | boolean | `true` when mnemonic was generated but `--show-mnemonic` was not passed |

When importing an existing mnemonic or private key, neither `mnemonic` nor `mnemonicRedacted` is present.

### `deposit`

```bash
pp deposit 0.1 --asset ETH --agent
pp deposit ETH 0.1 --agent --chain sepolia
```

> **Minimum deposit:** Each pool enforces a `minimumDeposit` (in wei). Query `pp pools --agent` and check the `minimumDeposit` field for the target asset before depositing. Amounts below this threshold will fail with `INPUT_ERROR`.

**Success:**

```json
{
  "operation": "deposit",
  "txHash": "0x...",
  "amount": "100000000000000000",
  "committedValue": "99500000000000000",
  "asset": "ETH",
  "chain": "mainnet",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "poolAddress": "0x...",
  "scope": "123...",
  "label": "456...",
  "blockNumber": "22153800",
  "explorerUrl": "https://etherscan.io/tx/0x...",
  "nextStep": "Poll 'privacy-pools accounts --agent' until aspStatus = approved (most deposits approve within 1 hour)"
}
```

`committedValue` is the net amount after vetting fee (may be `null`). `label` may be `null`. `nextStep` provides agent guidance. All token amounts and block numbers are strings.

**Dry-run** (`--dry-run`):

```json
{
  "dryRun": true,
  "operation": "deposit",
  "chain": "mainnet",
  "asset": "ETH",
  "amount": "100000000000000000",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "precommitment": "12345...",
  "balanceSufficient": true
}
```

`balanceSufficient` is `true`, `false`, or `"unknown"` (when no signer key is configured).

### `withdraw`

```bash
pp withdraw 0.05 --asset ETH --to 0xRecipient --agent
pp withdraw 0.05 --asset ETH --to 0xRecipient --from-pa PA-2 --agent
pp withdraw 0.1 --asset ETH --direct --agent
```

**Success (relayed):**

```json
{
  "operation": "withdraw",
  "mode": "relayed",
  "txHash": "0x...",
  "blockNumber": "22153900",
  "amount": "50000000000000000",
  "recipient": "0x...",
  "explorerUrl": "https://etherscan.io/tx/0x...",
  "poolAddress": "0x...",
  "scope": "123...",
  "asset": "ETH",
  "chain": "mainnet",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "feeBPS": "50"
}
```

**Success (direct):** same fields but `mode: "direct"`, `fee: null` instead of `feeBPS`.

**Dry-run:**

```json
{
  "mode": "relayed",
  "dryRun": true,
  "amount": "50000000000000000",
  "asset": "ETH",
  "chain": "mainnet",
  "recipient": "0x...",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "selectedCommitmentLabel": "456...",
  "selectedCommitmentValue": "100000000000000000",
  "proofPublicSignals": 8,
  "feeBPS": "50",
  "quoteExpiresAt": "2025-01-15T12:30:00Z"
}
```

For direct dry-run: `mode: "direct"`, no `feeBPS` or `quoteExpiresAt`.

**Withdrawal quote:**

```bash
pp withdraw quote 0.1 --asset ETH --to 0xRecipient --agent
```

```json
{
  "mode": "relayed-quote",
  "chain": "mainnet",
  "asset": "ETH",
  "amount": "100000000000000000",
  "recipient": "0x...",
  "minWithdrawAmount": "10000000000000000",
  "minWithdrawAmountFormatted": "0.01 ETH",
  "maxRelayFeeBPS": "50",
  "quoteFeeBPS": "50",
  "feeCommitmentPresent": true,
  "quoteExpiresAt": "2025-01-15T12:30:00Z"
}
```

### `ragequit`

```bash
pp ragequit --asset ETH --from-pa PA-1 --agent
```

**Success:**

```json
{
  "operation": "ragequit",
  "txHash": "0x...",
  "amount": "100000000000000000",
  "asset": "ETH",
  "chain": "mainnet",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "poolAddress": "0x...",
  "scope": "123...",
  "blockNumber": "22154000",
  "explorerUrl": "https://etherscan.io/tx/0x..."
}
```

**Dry-run:**

```json
{
  "dryRun": true,
  "operation": "ragequit",
  "chain": "mainnet",
  "asset": "ETH",
  "amount": "100000000000000000",
  "poolAccountNumber": 1,
  "poolAccountId": "PA-1",
  "selectedCommitmentLabel": "456...",
  "selectedCommitmentValue": "100000000000000000",
  "proofPublicSignals": 4
}
```

### `balance`

```bash
pp balance --agent
```

```json
{
  "chain": "mainnet",
  "balances": [
    {
      "asset": "ETH",
      "assetAddress": "0xEeee...EEeE",
      "balance": "500000000000000000",
      "commitments": 3,
      "poolAccounts": 3
    }
  ]
}
```

`balance` is total spendable amount in wei (string). `commitments` and `poolAccounts` are counts (numbers).

### `accounts`

```bash
pp accounts --agent [--all] [--details]
```

```json
{
  "chain": "mainnet",
  "accounts": [
    {
      "poolAccountNumber": 1,
      "poolAccountId": "PA-1",
      "status": "spendable",
      "aspStatus": "approved",
      "asset": "ETH",
      "scope": "123...",
      "value": "100000000000000000",
      "hash": "789...",
      "label": "456...",
      "blockNumber": "22153800",
      "txHash": "0x..."
    }
  ],
  "pendingCount": 0
}
```

`status` values: `"spendable"`, `"spent"`, `"exited"`. `aspStatus` values: `"pending"`, `"approved"`. `pendingCount` is the number of accounts with `aspStatus: "pending"`.

Poll `aspStatus` after depositing — wait for `"approved"` before withdrawing via the relayed path.

### `history`

```bash
pp history --agent [--limit <n>]
```

```json
{
  "chain": "mainnet",
  "events": [
    {
      "type": "deposit",
      "asset": "ETH",
      "poolAddress": "0x...",
      "poolAccountNumber": 1,
      "poolAccountId": "PA-1",
      "value": "100000000000000000",
      "blockNumber": "22153800",
      "txHash": "0x...",
      "explorerUrl": "https://etherscan.io/tx/0x..."
    }
  ]
}
```

`type` values: `"deposit"`, `"withdrawal"`, `"ragequit"`.

### `sync`

```bash
pp sync --agent [--asset <symbol>]
```

```json
{
  "chain": "mainnet",
  "syncedPools": 2,
  "syncedSymbols": ["ETH", "USDC"],
  "spendableCommitments": 5
}
```

`syncedSymbols` is present on successful sync (may be omitted on empty sync).

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `PRIVACY_POOLS_PRIVATE_KEY` | Ethereum private key (alternative to init wizard) |
| `PRIVACY_POOLS_HOME` | Override config directory (default: `~/.privacy-pools`) |
| `PRIVACY_POOLS_CONFIG_DIR` | Alias for `PRIVACY_POOLS_HOME` |
| `PP_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PP_RPC_URL_ARBITRUM`) |
| `PP_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PP_ASP_HOST_SEPOLIA`) |
| `PP_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |

The CLI loads `.env` from the config directory (`~/.privacy-pools/.env`), not from the current working directory. All flags take precedence over environment variables.

---

## Error format

All errors in JSON mode:

```json
{
  "schemaVersion": "1.3.0",
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

### Error codes

| Code | Category | Retryable | Meaning |
|------|----------|-----------|---------|
| `INPUT_ERROR` | INPUT | No | Bad arguments, missing flags |
| `RPC_ERROR` | RPC | No | RPC call failure |
| `RPC_NETWORK_ERROR` | RPC | Yes | Network connectivity issue |
| `ASP_ERROR` | ASP | No | ASP service failure |
| `RELAYER_ERROR` | RELAYER | No | Relayer request failure |
| `PROOF_ERROR` | PROOF | No | Proof generation failure |
| `PROOF_GENERATION_FAILED` | PROOF | No | ZK proof could not be generated |
| `PROOF_MERKLE_ERROR` | PROOF | Yes | Commitment not in Merkle tree (sync first) |
| `PROOF_MALFORMED` | PROOF | No | Corrupt proof data |
| `CONTRACT_NULLIFIER_ALREADY_SPENT` | CONTRACT | No | Pool Account already withdrawn |
| `CONTRACT_INCORRECT_ASP_ROOT` | CONTRACT | Yes | State changed, regenerate proof |
| `CONTRACT_INVALID_PROOF` | CONTRACT | No | Proof rejected on-chain |
| `CONTRACT_INVALID_PROCESSOOOR` | CONTRACT | No | Wrong withdrawal mode |
| `CONTRACT_PRECOMMITMENT_ALREADY_USED` | CONTRACT | No | Duplicate precommitment, retry deposit |
| `CONTRACT_ONLY_ORIGINAL_DEPOSITOR` | CONTRACT | No | Wrong signer for ragequit |
| `CONTRACT_NO_ROOTS_AVAILABLE` | CONTRACT | Yes | Pool not ready, wait and retry |
| `UNKNOWN_ERROR` | UNKNOWN | No | Unexpected error |

### Exit codes

| Code | Category |
|------|----------|
| 0 | Success |
| 1 | Unknown |
| 2 | Input |
| 3 | RPC |
| 4 | ASP |
| 5 | Relayer |
| 6 | Proof |
| 7 | Contract |

### Retry strategy

When `retryable: true`:
1. `RPC_NETWORK_ERROR`: exponential backoff (1s, 2s, 4s), max 3 retries
2. `CONTRACT_INCORRECT_ASP_ROOT` / `PROOF_MERKLE_ERROR`: run `pp sync --agent`, then retry
3. `CONTRACT_NO_ROOTS_AVAILABLE`: wait 30-60s and retry

---

## Supported chains

| Name | Chain ID | Testnet | Entrypoint |
|------|----------|---------|------------|
| `mainnet` | 1 | No | `0x6818809eefce719e480a7526d76bd3e561526b46` |
| `arbitrum` | 42161 | No | `0x44192215fed782896be2ce24e0bfbf0bf825d15e` |
| `optimism` | 10 | No | `0x44192215fed782896be2ce24e0bfbf0bf825d15e` |
| `sepolia` | 11155111 | Yes | `0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb` |
| `op-sepolia` | 11155420 | Yes | `0x54aca0d27500669fa37867233e05423701f11ba1` |

---

## Links

- npm: [privacy-pools-cli](https://www.npmjs.com/package/privacy-pools-cli)
- Privacy Pools: [https://privacypools.com](https://privacypools.com)
- 0xbow: [https://0xbow.io](https://0xbow.io)
