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

With `--unsigned tx`, output is a bare array of transaction objects:

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

**Ragequit (exit alias):**
- `operation`: `"ragequit"`
- `selectedCommitmentLabel`, `selectedCommitmentValue`: commitment details as decimal strings

---

## JSON output shapes by command

All responses include `{ "schemaVersion": "1.3.0", "success": true, ... }` envelope.

Some success payloads also include optional `nextActions[]` guidance with the shape `{ command, reason, when, args?, options? }`. Treat `nextActions` as the canonical machine follow-up field.

### `pools`

```bash
privacy-pools pools --agent [--all-chains] [--search <query>] [--sort <mode>]
privacy-pools pools ETH --agent                    # detail view for a specific pool
```

Defaults to all mainnets when no `--chain` is specified. Default sort is `tvl-desc` (highest pool balance first).

**Detail view** (`privacy-pools pools <asset>`): Shows pool stats, your funds (if wallet initialized), and recent activity for a single pool. JSON mode returns `{ chain, asset, tokenAddress, pool, scope, ..., myFunds?, recentActivity? }`. Does not support CSV.

**Single chain** (with `--chain`):

```json
{
  "chain": "mainnet",
  "search": null,
  "sort": "default",
  "pools": [
    {
      "asset": "ETH",
      "tokenAddress": "0xEeee...EEeE",
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
      "growth24h": 5.2,
      "pendingGrowth24h": 1.1
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

`asset` is the CLI asset symbol to use in follow-up commands. `tokenAddress` is the token address.

All numeric token amounts are in wei (strings). USD values, counts, and growth rates are nullable.

### `activity`

```bash
privacy-pools activity --agent [--asset <symbol>] [--limit <n>] [--page <n>]
```

Defaults to all mainnets when no `--chain` is specified.

**Global:**

```json
{
  "mode": "global-activity",
  "chain": "all-mainnets",
  "chains": ["mainnet", "arbitrum", "optimism"],
  "page": 1,
  "perPage": 12,
  "total": 100,
  "totalPages": 9,
  "events": [
    {
      "type": "deposit",
      "txHash": "0x...",
      "explorerUrl": "https://etherscan.io/tx/0x...",
      "reviewStatus": "approved",
      "amountRaw": "100000000000000000",
      "amountFormatted": "0.1 ETH",
      "poolSymbol": "ETH",
      "poolAddress": "0x...",
      "chainId": 1,
      "timestamp": "2023-11-14T22:13:20.000Z"
    }
  ]
}
```

When querying multiple chains (no `--chain` specified), `chain` is `"all-mainnets"` and `chains` lists the queried chain names. With a specific `--chain` but no `--asset`, events are filtered client-side: `total` and `totalPages` are `null`, `chainFiltered` is `true`, and a `note` field explains the limitation.

**Per-pool** (`--asset`): `mode` is `"pool-activity"` and root includes `asset`, `pool`, and `scope`. Pagination totals are accurate (server-side filtering).

`timestamp` is an ISO 8601 string or `null`. `total` and `totalPages` may be null (always null when `chainFiltered: true`).

### `stats global`

```bash
privacy-pools stats global --agent
```

Always returns aggregate cross-chain statistics. The `--chain` flag is **not** supported; use `stats pool --asset <symbol> --chain <chain>` for chain-specific data.

```json
{
  "mode": "global-stats",
  "chain": "all-mainnets",
  "chains": ["mainnet", "arbitrum", "optimism"],
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
  },
  "perChain": [
    {
      "chain": "mainnet",
      "cacheTimestamp": "2025-01-15T12:00:00Z",
      "allTime": { "tvlUsd": "500000", "totalDepositsCount": 1000, "totalWithdrawalsCount": 750 },
      "last24h": { "tvlUsd": "500000", "totalDepositsCount": 10, "totalWithdrawalsCount": 5 }
    }
  ]
}
```

`chain` is always `"all-mainnets"`. `chains` lists the queried chain names. `perChain` contains per-chain breakdowns. `cacheTimestamp`, `allTime`, and `last24h` may be null. The `allTime`/`last24h` objects come from the ASP service and may contain additional fields.

### `stats pool`

```bash
privacy-pools stats pool --asset ETH --agent
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
privacy-pools status --agent [--check] [--check-rpc] [--check-asp]
```

```json
{
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
  "entrypoint": "0x6818809eefce719e480a7526d76bd3e561526b46",
  "aspHost": "https://api.0xbow.io",
  "aspLive": true,
  "rpcLive": true,
  "rpcBlockNumber": "22153800",
  "accountFiles": [{ "chain": "mainnet", "chainId": 1 }],
  "readyForDeposit": true,
  "readyForWithdraw": true,
  "readyForUnsigned": true,
  "nextActions": [
    {
      "command": "pools",
      "reason": "Check on your existing deposits.",
      "when": "status_ready_has_accounts",
      "options": { "agent": true, "chain": "mainnet" }
    }
  ]
}
```

Health checks run by default when a chain is selected. Pass `--no-check` to suppress them, or use `--check-rpc` / `--check-asp` to run only specific checks.

When setup is incomplete, `nextActions` includes a canonical `init` follow-up for agent orchestrators. When no deposits exist, `nextActions` points to `pools`; when deposits already exist, it points to `accounts`. If the recovery phrase is configured but no valid signer key is available, those follow-ups stay read-only while `readyForDeposit` remains `false`.

| Field | Type | When present |
|-------|------|-------------|
| `aspLive` | boolean | Default when chain selected; `--check` or `--check-asp` |
| `rpcLive` | boolean | Default when chain selected; `--check` or `--check-rpc` |
| `rpcBlockNumber` | string | When `rpcLive` is true |

### `capabilities`

```bash
privacy-pools capabilities --agent
```

Representative payload (abridged):

```json
{
  "commands": [
    {
      "name": "deposit",
      "description": "Deposit into a pool",
      "flags": ["--asset <symbol|address>", "--unsigned [envelope|tx]", "--dry-run"],
      "agentFlags": "--json --yes",
      "requiresInit": true
    }
  ],
  "commandDetails": {
    "accounts": {
      "command": "accounts",
      "flags": ["--no-sync", "--all", "--details", "--summary", "--pending-only"]
    }
  },
  "globalFlags": [
    { "flag": "--agent", "description": "Machine-friendly mode (alias for --json --yes --quiet)" }
  ],
  "agentWorkflow": [
    "1. privacy-pools status --json",
    "2. privacy-pools init --json --yes --default-chain <chain> --show-mnemonic",
    "3. privacy-pools pools --json --chain <chain>",
    "4. privacy-pools deposit <amount> --asset <symbol> --json --yes --chain <chain>",
    "5. privacy-pools accounts --json --chain <chain> --pending-only  (poll until aspStatus: approved)",
    "6. privacy-pools withdraw <amount> --asset <symbol> --to <address> --json --yes --chain <chain>"
  ],
  "agentNotes": {
    "polling": "After depositing, poll 'accounts --json --pending-only' to check aspStatus. Most deposits are approved within 1 hour; some may take up to 7 days. Do not attempt withdrawal until aspStatus is 'approved'.",
    "withdrawQuote": "Use 'withdraw quote <amount> --asset <symbol> --json' to check relayer fees before committing to a withdrawal.",
    "firstRun": "First proof generation may provision checksum-verified circuit artifacts automatically (~60s one-time). Subsequent proofs are faster (~10-30s).",
    "unsignedMode": "--unsigned builds transaction payloads without signing or submitting. Use --unsigned tx for a raw transaction array (no envelope). Requires init (recovery phrase) for deposit secret generation, but does NOT require a signer key. The 'from' field is null; the signing party fills in their own address.",
    "metaFlag": "--agent is equivalent to --json --yes --quiet. Use it to suppress all stderr output and skip prompts.",
    "statusCheck": "Run 'status --json' before transacting. readyForDeposit/readyForWithdraw/readyForUnsigned are configuration capability flags — they confirm the wallet is set up, NOT that spendable funds exist. Check 'accounts --json' to verify fund availability before withdrawing."
  },
  "schemas": {
    "aspApprovalStatus": { "values": ["approved", "pending", "unknown"] },
    "poolAccountStatus": { "values": ["spendable", "spent", "exited"] },
    "errorCategories": { "values": ["INPUT", "RPC", "ASP", "RELAYER", "PROOF", "CONTRACT", "UNKNOWN"] },
    "nextActions": {
      "shape": "{ command, reason, when, args?, options? }",
      "description": "Canonical workflow guidance for agents. Follow these command suggestions instead of parsing natural-language output."
    }
  },
  "safeReadOnlyCommands": ["pools", "activity", "stats", "stats global", "stats pool", "status", "capabilities", "describe", "guide", "completion"],
  "supportedChains": [
    { "name": "mainnet", "chainId": 1, "testnet": false },
    { "name": "arbitrum", "chainId": 42161, "testnet": false },
    { "name": "optimism", "chainId": 10, "testnet": false },
    { "name": "sepolia", "chainId": 11155111, "testnet": true },
    { "name": "op-sepolia", "chainId": 11155420, "testnet": true }
  ],
  "jsonOutputContract": "All commands emit { schemaVersion, success, ...payload } on stdout when --json is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage, category, hint, retryable }. Exception: --unsigned tx emits a raw transaction array without the envelope."
}
```

### `describe`

```bash
privacy-pools describe withdraw quote --agent
privacy-pools describe stats global --agent
```

```json
{
  "command": "withdraw quote",
  "description": "Request relayer quote and limits without generating a proof",
  "aliases": [],
  "usage": "withdraw quote <amount> --asset <symbol|address>",
  "flags": ["--asset <symbol|address>", "--to <address>"],
  "globalFlags": ["--agent", "-j, --json", "-y, --yes"],
  "requiresInit": true,
  "expectedLatencyClass": "medium",
  "safeReadOnly": false,
  "prerequisites": ["init"],
  "examples": ["privacy-pools withdraw quote 0.1 ETH --to 0xRecipient..."],
  "jsonFields": "{ mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, extraGas?, nextActions? }",
  "jsonVariants": [],
  "safetyNotes": [],
  "supportsUnsigned": false,
  "supportsDryRun": false,
  "agentWorkflowNotes": ["Quotes expire quickly; submit the withdrawal promptly after quoting if the fee is acceptable."]
}
```

### `init`

```bash
privacy-pools init --agent --default-chain mainnet --show-mnemonic
privacy-pools init --agent --mnemonic "word1 word2 ..." --default-chain mainnet
cat phrase.txt | privacy-pools init --agent --mnemonic-stdin --default-chain mainnet
privacy-pools init --agent --private-key 0x... --default-chain mainnet
privacy-pools init --agent --private-key-file ./key.txt --default-chain mainnet
printf '%s\n' 0x... | privacy-pools init --agent --mnemonic "word1 word2 ..." --private-key-stdin --default-chain mainnet
```

```json
{
  "defaultChain": "mainnet",
  "signerKeySet": true,
  "recoveryPhrase": "test test test test test test test test test test test junk",
  "nextActions": [
    {
      "command": "status",
      "reason": "Verify wallet readiness and chain health before transacting.",
      "when": "after_init",
      "options": { "agent": true, "chain": "mainnet" }
    }
  ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `defaultChain` | string | The chain set during init |
| `signerKeySet` | boolean | Whether a signer key was configured |
| `recoveryPhrase` | string | Contains the recovery phrase only when `--show-mnemonic` is passed and a new one was generated |
| `recoveryPhraseRedacted` | boolean | `true` when a recovery phrase was generated but `--show-mnemonic` was not passed |
| `nextActions` | array | Optional structured follow-up commands for agents |

When importing an existing recovery phrase or private key, neither `recoveryPhrase` nor `recoveryPhraseRedacted` is present.

Use only one stdin secret source per invocation: either `--mnemonic-stdin` or `--private-key-stdin`.

### `deposit`

```bash
privacy-pools deposit 0.1 ETH --agent
privacy-pools deposit 0.1 --asset ETH --agent
```

> **Minimum deposit:** Each pool enforces a `minimumDeposit` (in wei). Query `privacy-pools pools --agent` and check the `minimumDeposit` field for the target asset before depositing. Amounts below this threshold will fail with `INPUT_ERROR`.

> **Privacy guard:** In machine modes, non-round deposit amounts are rejected by default because they can fingerprint the deposit. Prefer round amounts, or pass `--ignore-unique-amount` only when you explicitly want to bypass that protection.

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
  "nextActions": [
    {
      "command": "accounts",
      "reason": "Poll until aspStatus becomes approved before attempting a relayed withdrawal.",
      "when": "after_deposit",
      "options": { "agent": true, "chain": "mainnet", "pendingOnly": true }
    }
  ]
}
```

`committedValue` is the net amount after vetting fee (may be `null`). `label` may be `null`. `nextActions` is the canonical structured guidance for agents and points to `accounts --pending-only`. All token amounts and block numbers are strings.

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
privacy-pools withdraw 0.05 ETH --to 0xRecipient --agent
privacy-pools withdraw 0.05 ETH --to 0xRecipient --from-pa PA-2 --agent
privacy-pools withdraw --all ETH --to 0xRecipient --agent
privacy-pools withdraw 50% ETH --to 0xRecipient --agent
privacy-pools withdraw 0.1 ETH --direct --agent
privacy-pools withdraw 0.05 ETH --to 0xRecipient --no-extra-gas --agent
```

**Amount shortcuts:** `--all` withdraws the entire PA balance. Percentages (`50%`, `100%`) withdraw a fraction. After PA selection, the CLI shows the selected PA's available balance.

**Extra gas (ERC20 only):** `--extra-gas` (default: true for ERC20 tokens) requests gas tokens alongside the withdrawal. Use `--no-extra-gas` to opt out. Ignored for native ETH.

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
  "feeBPS": "50",
  "extraGas": true,
  "remainingBalance": "50000000000000000",
  "anonymitySet": {
    "eligible": 42,
    "total": 128,
    "percentage": 32.81
  }
}
```

**Success (direct):** same fields but `mode: "direct"`, `fee: null` instead of `feeBPS`, no `extraGas`, and human output includes a note that direct withdrawal links deposit and withdrawal onchain.

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
  "quoteExpiresAt": "2025-01-15T12:30:00Z",
  "anonymitySet": {
    "eligible": 42,
    "total": 128,
    "percentage": 32.81
  }
}
```

For direct dry-run: `mode: "direct"`, no `feeBPS` or `quoteExpiresAt`.

**Withdrawal quote:**

```bash
privacy-pools withdraw quote 0.1 ETH --to 0xRecipient --agent
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
  "quoteFeeBPS": "50",
  "feeAmount": "5000000000000000",
  "netAmount": "95000000000000000",
  "feeCommitmentPresent": true,
  "quoteExpiresAt": "2025-01-15T12:30:00Z",
  "extraGas": true,
  "nextActions": [
    {
      "command": "withdraw",
      "reason": "Submit the withdrawal promptly if the quoted fee is acceptable.",
      "when": "after_quote",
      "args": ["0.1", "ETH"],
      "options": {
        "agent": true,
        "chain": "mainnet",
        "to": "0x...",
        "extraGas": true
      }
    }
  ]
}
```

`feeAmount` and `netAmount` are computed from `amount` and `quoteFeeBPS`. `extraGas` is present for ERC20 tokens (default `true`), omitted for native ETH. `nextActions` provides a ready-to-run `withdraw` follow-up with the quoted parameters.

### `ragequit` (alias: `exit`)

```bash
privacy-pools ragequit ETH --from-pa PA-1 --agent
privacy-pools exit ETH --from-pa PA-1 --agent
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

### `accounts`

```bash
privacy-pools accounts --agent [--all] [--details]
privacy-pools accounts --agent --all-chains
privacy-pools accounts --agent --summary
privacy-pools accounts --agent --pending-only
```

```json
{
  "chain": "all-mainnets",
  "chains": ["mainnet", "arbitrum", "optimism"],
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
      "txHash": "0x...",
      "explorerUrl": "https://etherscan.io/tx/0x...",
      "chain": "mainnet",
      "chainId": 1
    }
  ],
  "balances": [
    {
      "asset": "ETH",
      "balance": "500000000000000000",
      "usdValue": "$1,000.00",
      "poolAccounts": 3,
      "chain": "mainnet",
      "chainId": 1
    }
  ],
  "pendingCount": 0,
  "warnings": []
}
```

`status` values: `"spendable"`, `"spent"`, `"exited"`. `aspStatus` values: `"pending"`, `"approved"`, `"unknown"` (`"unknown"` for spent or exited accounts). `pendingCount` is the number of accounts with `aspStatus: "pending"`.

Without `--chain`, `accounts` aggregates all mainnets by default. Use `--all-chains` to include testnets. In multi-chain responses, `poolAccountId` remains chain-local, so pair it with `chain` or `chainId`.

`balances` contains per-pool totals for spendable accounts. `balance` is the total spendable amount in wei (string). `usdValue` is a formatted USD string (or `null` when price data is unavailable).

`--summary` returns `{ chain, allChains?, chains?, warnings?, pendingCount, approvedCount, spendableCount, spentCount, exitedCount, balances, nextActions? }` and omits `accounts`.

`--pending-only` returns `{ chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions? }`, filters to `aspStatus: "pending"`, and omits `balances`.

Poll `aspStatus` after depositing with `accounts --agent --pending-only` and wait for `"approved"` before withdrawing via the relayed path. `nextActions` on `accounts` are poll-oriented only and appear when pending approvals still exist.

### `history`

```bash
privacy-pools history --agent [--limit <n>]
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

Force-sync local account state. Most commands auto-sync with a 2-minute freshness TTL, so explicit sync is rarely needed.

```bash
privacy-pools sync --agent [--asset <symbol>]
```

```json
{
  "chain": "mainnet",
  "syncedPools": 2,
  "syncedSymbols": ["ETH", "USDC"],
  "availablePoolAccounts": 5,
  "previousAvailablePoolAccounts": 3
}
```

`syncedSymbols` is present on successful sync (may be omitted on empty sync). `previousAvailablePoolAccounts` shows the count before sync — compare with `availablePoolAccounts` to detect newly discovered accounts.

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
| `NO_COLOR` | Disable colored output (same as `--no-color`) |
| `PP_NO_UPDATE_CHECK` | Set to `1` to disable the update-available notification |
| `PRIVACY_POOLS_CIRCUITS_DIR` | Override circuit artifact cache directory (default: `~/.privacy-pools/circuits/v<sdk-version>`) |

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
| `RPC_POOL_RESOLUTION_FAILED` | RPC | Yes | Pool resolution failed (ASP + RPC both down) |
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
| `CONTRACT_ONLY_ORIGINAL_DEPOSITOR` | CONTRACT | No | Wrong signer for exit |
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
1. `RPC_NETWORK_ERROR` / `RPC_POOL_RESOLUTION_FAILED`: exponential backoff (1s, 2s, 4s), max 3 retries
2. `CONTRACT_INCORRECT_ASP_ROOT` / `PROOF_MERKLE_ERROR`: run `privacy-pools sync --agent`, then retry
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
