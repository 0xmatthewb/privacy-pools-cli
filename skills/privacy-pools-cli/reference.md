# Privacy Pools CLI Reference

Detailed payload spec, JSON output shapes, and unsigned transaction format for agent integration.

## Easy-path workflow

The CLI ships a persisted happy-path workflow under `flow`:

```bash
privacy-pools flow start 0.1 ETH --to 0xRecipient --agent
privacy-pools flow start 0.1 ETH --to 0xRecipient --privacy-delay off --agent
privacy-pools flow start 100 USDC --to 0xRecipient --new-wallet --export-new-wallet ./flow-wallet.txt --agent
privacy-pools flow watch latest --agent
privacy-pools flow watch latest --privacy-delay aggressive --agent   # updates the saved privacy-delay policy
privacy-pools flow status latest --agent
privacy-pools flow ragequit latest --agent
```

`flow start` performs the normal public deposit, saves a workflow locally, and targets a later relayed private withdrawal (the relayer submits the withdrawal onchain) from that same Pool Account (the saved deposit lineage) to the saved recipient. In machine modes, it follows the same non-round amount privacy guard as `deposit`, so prefer round amounts unless you intentionally accept that tradeoff. A round input can still become a non-round committed balance after the vetting fee is deducted, so `flow start` may still emit an advisory amount-pattern warning for the later full-balance auto-withdrawal. New workflows default to a balanced post-approval privacy delay: `off` means no added hold, `balanced` randomizes the hold between 15 and 90 minutes, and `aggressive` randomizes the hold between 2 and 12 hours. Pass `--privacy-delay off|balanced|aggressive` to `flow start`, or later to `flow watch`, to update the saved policy persistently. `off` clears any saved hold immediately, while switching between `balanced` and `aggressive` resamples from the override time. With `--new-wallet`, the CLI generates a dedicated workflow wallet, requires a backup before proceeding, and waits for funding automatically. ETH flows wait for the full ETH target. ERC20 flows wait for both the token amount and a native ETH gas reserve in that same wallet. The generated workflow key is also stored locally under `~/.privacy-pools/workflow-secrets/` until the workflow completes, public-recovers, or is externally stopped, so `--export-new-wallet` is a backup copy rather than the only retained secret. `flow watch` re-checks the saved workflow using workflow phases such as `awaiting_funding`, `depositing_publicly`, `awaiting_asp`, `approved_waiting_privacy_delay`, `approved_ready_to_withdraw`, `withdrawing`, `completed`, `completed_public_recovery`, `paused_declined`, `paused_poi_required`, and `stopped_external`, while `aspStatus` continues to carry the deposit review state from the ASP (the approval service). Paused states are still successful command results: declined workflows surface `flow ragequit` as the canonical public recovery path, and PoA-required workflows can either resume privately after the external Proof of Association step or recover publicly with `flow ragequit`. `flow watch` is intentionally unbounded; agents that need a wall-clock limit should wrap it in an external timeout. `flow status` reads the persisted workflow snapshot without mutating it. `flow ragequit` performs the saved-workflow public recovery path and, for configured-wallet workflows, requires the original depositor signer.

Flow JSON payloads share this shape:

```json
{
  "schemaVersion": "1.7.0",
  "success": true,
  "mode": "flow",
  "action": "start",
  "workflowId": "123e4567-e89b-12d3-a456-426614174000",
  "phase": "awaiting_funding",
  "walletMode": "new_wallet",
  "walletAddress": "0x...",
  "requiredNativeFunding": "3500000000000000",
  "requiredTokenFunding": "100000000",
  "backupConfirmed": true,
  "chain": "mainnet",
  "asset": "USDC",
  "depositAmount": "100000000",
  "recipient": "0x...",
  "privacyDelayProfile": "balanced",
  "privacyDelayConfigured": true,
  "privacyDelayUntil": null,
  "warnings": [],
  "nextActions": [
    {
      "command": "flow watch",
      "reason": "Resume this saved workflow and continue toward the private withdrawal.",
      "when": "flow_resume",
      "args": ["123e4567-e89b-12d3-a456-426614174000"],
      "options": { "agent": true },
      "runnable": true
    }
  ]
}
```

`privacyDelayConfigured = false` means a legacy saved workflow was normalized to `off` without an explicitly saved privacy-delay policy.

Possible `phase` values:

- `awaiting_funding`
- `depositing_publicly`
- `awaiting_asp`
- `approved_waiting_privacy_delay`
- `approved_ready_to_withdraw`
- `withdrawing`
- `completed`
- `completed_public_recovery`
- `paused_poi_required`
- `paused_declined`
- `stopped_external`

Paused workflow states are successful command results, not CLI errors. Declined workflows surface `flow ragequit` as the canonical saved-workflow public recovery path, and PoA-required workflows can either resume privately after the external Proof of Association step or recover publicly with `flow ragequit`. Manual commands remain available for advanced control.

---

## Unsigned payload spec

All `--unsigned` output targets the chain specified by `--chain` (default: your configured default chain; if no default is configured yet, it falls back to `mainnet`, chain ID 1).

### Payload shape (envelope format)

```json
{
  "schemaVersion": "1.7.0",
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

### Field reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | yes | Target contract address (`0x` + 40 hex chars) |
| `data` | `string` | yes | ABI-encoded calldata (`0x` + hex) |
| `value` | `string` | yes | ETH amount in wei as a **string** (e.g. `"0"`, `"100000000000000000"`) |
| `valueHex` | `string` | tx format only | Wei as hex string (e.g. `"0x16345785d8a0000"`) |
| `chainId` | `number` | yes | Target chain ID |
| `from` | `string\|null` | yes | Signer address when the caller is constrained; `null` when the signer is unconstrained |
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

All responses include `{ "schemaVersion": "1.7.0", "success": true, ... }` envelope.

Some success payloads also include optional `nextActions[]` guidance with the shape `{ command, reason, when, args?, options?, runnable? }`. Treat `nextActions` as the canonical machine follow-up field. When `runnable` is `false`, the action is a template that needs additional user input before execution.

### `pools`

```bash
privacy-pools pools --agent [--all-chains] [--search <query>] [--sort <mode>]
privacy-pools pools ETH --agent                    # detail view for a specific pool
```

Defaults to all CLI-supported mainnet chains when no `--chain` is specified. Default sort is `tvl-desc` (highest pool balance first).

**Detail view** (`privacy-pools pools <asset>`): Shows pool stats, your funds (if wallet state can be loaded), and recent activity for a single pool. JSON mode returns `{ chain, asset, tokenAddress, pool, scope, ..., myFunds?, myFundsWarning?, recentActivity? }`. `myFunds.balance` is total remaining balance across active Pool Accounts in that pool; private withdrawal still requires `status/aspStatus = "approved"`. When `myFunds` is `null`, `myFundsWarning` may explain why wallet state could not be loaded. Does not support CSV.

**Single chain** (with `--chain`):

```json
{
  "chain": "mainnet",
  "search": null,
  "sort": "tvl-desc",
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
  "sort": "tvl-desc",
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

Defaults to all CLI-supported mainnet chains when no `--chain` is specified.

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
  "recommendedMode": "ready",
  "nextActions": [
    {
      "command": "accounts",
      "reason": "Check on your existing deposits.",
      "when": "status_ready_has_accounts",
      "options": { "agent": true }
    }
  ]
}
```

Health checks run by default when a chain is selected. Pass `--no-check` to suppress them, or use `--check-rpc` / `--check-asp` to run only specific checks.
Custom `rpcUrl` and `aspHost` values are rendered in a display-safe form: userinfo, query strings, and token-like path segments are redacted before they are printed.

When setup is incomplete, `nextActions` includes a canonical `init` follow-up for agent orchestrators. When no deposits exist, `nextActions` points to `pools`; when deposits already exist, it points to `accounts`. If the recovery phrase is configured but no valid signer key is available, those follow-ups stay read-only while `readyForDeposit` remains `false`. For machine gating, prefer `recommendedMode`, `blockingIssues[]`, and `warnings[]` over inferring from the boolean readiness flags alone. When `recommendedMode = "read-only"`, status detected degraded RPC or ASP health, so `nextActions` stays on public discovery and only non-transactional commands should be treated as safe until connectivity is restored. If only the ASP is down while RPC stays healthy, public recovery still remains available through `ragequit`, `flow ragequit`, or unsigned ragequit payloads when the affected account or workflow is already known.

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
      "agentFlags": "--agent",
      "requiresInit": true
    }
  ],
  "commandDetails": {
    "accounts": {
      "command": "accounts",
      "flags": ["--no-sync", "--all-chains", "--details", "--summary", "--pending-only"],
      "sideEffectClass": "local_state_write",
      "touchesFunds": false,
      "requiresHumanReview": false
    }
  },
  "executionRoutes": {
    "stats pool": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured", "help"] }
  },
  "globalFlags": [
    { "flag": "--agent", "description": "Machine-friendly mode (alias for --json --yes --quiet)" }
  ],
  "agentWorkflow": [
    "1. privacy-pools status --agent",
    "2. privacy-pools init --agent --default-chain <chain> --show-mnemonic",
    "3. privacy-pools pools --agent --chain <chain>",
    "4. privacy-pools flow start <amount> <asset> --to <address> --agent --chain <chain>",
    "5. privacy-pools flow watch [workflowId|latest] --agent",
    "6. privacy-pools flow ragequit [workflowId|latest] --agent  (if the saved workflow is declined)",
    "7. privacy-pools deposit <amount> --asset <symbol> --agent --chain <chain>  (manual alternative)",
    "8. privacy-pools accounts --agent --chain <chain> --pending-only  (reviewed entries disappear; confirm approved vs declined vs poi_required with accounts --agent --chain <chain>)",
    "9. privacy-pools withdraw <amount> --asset <symbol> --to <address> --agent --chain <chain>"
  ],
  "agentNotes": {
    "polling": "After depositing, poll 'accounts --agent --chain <chain> --pending-only' while the Pool Account remains pending. Reviewed entries disappear from --pending-only results; once gone, re-run 'accounts --agent --chain <chain>' to confirm whether aspStatus is 'approved', 'declined', or 'poi_required'. Withdraw only after approval; ragequit if declined; complete Proof of Association at tornado.0xbow.io first if poi_required. Always preserve the same --chain scope for both polling and confirmation. Most deposits approve within 1 hour; some may take up to 7 days. Follow nextActions from the deposit response for the canonical polling command.",
    "withdrawQuote": "Use 'withdraw quote <amount> --asset <symbol> --agent' to check relayer fees before committing to a withdrawal.",
    "firstRun": "First proof generation may provision checksum-verified circuit artifacts automatically (~60s one-time). Subsequent proofs are faster (~10-30s).",
    "unsignedMode": "--unsigned builds transaction payloads without signing or submitting. Use --unsigned tx for a raw transaction array (no envelope). Requires init (recovery phrase) for deposit secret generation, but does NOT require a signer key. The 'from' field is included for signer-aware workflows: it is null when the signer is unconstrained, and set to the required caller address when the protocol requires one.",
    "metaFlag": "--agent is equivalent to --json --yes --quiet. Use it to suppress all stderr output and skip prompts.",
    "statusCheck": "Run 'status --agent' before transacting. Use recommendedMode plus blockingIssues[]/warnings[] for machine gating, and keep readyForDeposit/readyForWithdraw/readyForUnsigned as configuration capability flags only. Those flags confirm the wallet is set up, NOT that withdrawable funds exist. Check 'accounts --agent --chain <chain>' to verify fund availability before withdrawing on a specific chain. Use bare 'accounts --agent' only for the default multi-chain mainnet dashboard. When recommendedMode is read-only because RPC or ASP health is degraded, follow status nextActions back to public discovery and avoid account-state guidance until connectivity is restored. If only the ASP is down while RPC stays healthy, public recovery still remains available through ragequit, flow ragequit, or unsigned ragequit payloads when the affected account or workflow is already known."
  },
  "schemas": {
    "aspApprovalStatus": { "values": ["approved", "pending", "poi_required", "declined", "unknown"] },
    "poolAccountStatus": { "values": ["approved", "pending", "poi_required", "declined", "unknown", "spent", "exited"] },
    "errorCategories": {
      "values": ["INPUT", "RPC", "ASP", "RELAYER", "PROOF", "CONTRACT", "UNKNOWN"],
      "description": "Error responses include top-level errorCode/errorMessage plus error.{ code, category, message, hint?, retryable? }."
    },
    "nextActions": {
      "shape": "{ command, reason, when, args?, options?, runnable? }",
      "description": "Canonical workflow guidance for agents. Follow these command suggestions instead of parsing natural-language output. When runnable is false, the action is a template that needs additional user input before execution."
    }
  },
  "protocol": {
    "profile": "privacy-pools-v1",
    "displayName": "Privacy Pools v1",
    "coreSdkPackage": "@0xbow/privacy-pools-core-sdk",
    "coreSdkVersion": "1.2.0"
  },
  "runtime": {
    "cliVersion": "1.7.0",
    "jsonSchemaVersion": "1.7.0",
    "runtimeVersion": "v1",
    "workerProtocolVersion": "1",
    "manifestVersion": "1",
    "nativeBridgeVersion": "1",
    "workflowSnapshotVersion": "2",
    "workflowSecretVersion": "1"
  },
  "safeReadOnlyCommands": ["flow status", "pools", "activity", "stats", "stats global", "stats pool", "status", "capabilities", "describe", "guide", "migrate", "migrate status", "completion"],
  "supportedChains": [
    { "name": "mainnet", "chainId": 1, "testnet": false },
    { "name": "arbitrum", "chainId": 42161, "testnet": false },
    { "name": "optimism", "chainId": 10, "testnet": false },
    { "name": "sepolia", "chainId": 11155111, "testnet": true },
    { "name": "op-sepolia", "chainId": 11155420, "testnet": true }
  ],
  "jsonOutputContract": "All commands emit { schemaVersion, success, ...payload } on stdout when --json or --agent is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage, error: { code, category, message, hint?, retryable? } }. Exception: --unsigned tx emits a raw transaction array without the envelope.",
  "documentation": {
    "reference": "docs/reference.md",
    "agentGuide": "AGENTS.md",
    "changelog": "CHANGELOG.md",
    "runtimeUpgrades": "docs/runtime-upgrades.md",
    "jsonContract": "docs/contracts/cli-json-contract.v1.7.0.json"
  }
}
```

`executionRoutes` is the canonical execution-ownership map. `commandDetails` also includes risk metadata: `sideEffectClass`, `touchesFunds`, `requiresHumanReview`, and `preferredSafeVariant?`. `safeReadOnlyCommands` is separate: it only describes wallet-mutating safety, not whether a command runs in JS or native. `protocol` and `runtime` expose the current protocol profile plus bridge/storage compatibility versions.

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
  "safeReadOnly": true,
  "sideEffectClass": "read_only",
  "touchesFunds": false,
  "requiresHumanReview": false,
  "prerequisites": ["init"],
  "examples": ["privacy-pools withdraw quote 0.1 ETH --to 0xRecipient..."],
  "jsonFields": "{ mode: \"relayed-quote\", chain, asset, amount, recipient, minWithdrawAmount, minWithdrawAmountFormatted, baseFeeBPS, quoteFeeBPS, feeAmount, netAmount, feeCommitmentPresent, quoteExpiresAt, relayTxCost, extraGas?, extraGasFundAmount?, extraGasTxCost?, nextActions? }",
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
privacy-pools init --agent --mnemonic-file ./recovery.txt --default-chain mainnet
cat phrase.txt | privacy-pools init --agent --mnemonic-stdin --default-chain mainnet
privacy-pools init --agent --private-key-file ./key.txt --default-chain mainnet
printf '%s\n' 0x... | privacy-pools init --agent --mnemonic-file ./recovery.txt --private-key-stdin --default-chain mainnet
```

Inline `--mnemonic` and `--private-key` remain available as a last resort, but the preferred file/stdin flows above avoid leaking secrets into shell history or process listings.

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

New CLI-generated recovery phrases use 24 words (256-bit entropy). Imported recovery phrases may still be 12 or 24 words.

When `init` imports an existing recovery phrase, `nextActions` points to `migrate status --agent --all-chains` first so legacy migration or website-based recovery readiness can be checked before assuming imported account state is fully restorable in the CLI. When `init` generates a new wallet, `nextActions` points to `status --agent --chain <defaultChain>`.

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
      "reason": "Poll pending review for PA-1. When it disappears from pending results, re-run accounts --chain mainnet to confirm whether it was approved, declined, or needs Proof of Association (tornado.0xbow.io) before choosing withdraw or ragequit.",
      "when": "after_deposit",
      "options": { "agent": true, "chain": "mainnet", "pendingOnly": true }
    }
  ]
}
```

`committedValue` is the net amount after vetting fee (may be `null`). `label` may be `null`. `nextActions` provides the canonical polling command for agents; follow it to check approval status. All token amounts and block numbers are strings.

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

For relayed withdrawals, the CLI also warns if the chosen amount would leave a positive remainder below the relayer minimum. In that case, withdraw less, use `--all` / `100%`, or plan to recover the leftover balance publicly later.

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
  },
  "nextActions": [{ "command": "accounts", "reason": "...", "when": "after_withdraw", "options": { "agent": true, "chain": "mainnet" } }]
}
```

**Success (direct):** same fields but `mode: "direct"`, `feeBPS: null`, no `extraGas`, and human output includes a note that direct withdrawal links deposit and withdrawal onchain.

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
  "baseFeeBPS": "45",
  "quoteFeeBPS": "50",
  "feeAmount": "5000000000000000",
  "netAmount": "95000000000000000",
  "feeCommitmentPresent": true,
  "quoteExpiresAt": "2025-01-15T12:30:00Z",
  "relayTxCost": {
    "gas": "0",
    "eth": "100000000000000"
  },
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

`feeAmount` and `netAmount` are computed from `amount` and `quoteFeeBPS`. `baseFeeBPS` isolates the relayer base fee, while `relayTxCost` captures the estimated execution cost. `extraGas` is present for ERC20 tokens (default `true`), omitted for native ETH; when extra gas funding is included, `extraGasFundAmount` and `extraGasTxCost` describe the additional ETH components. `nextActions` provides a `withdraw` follow-up with the quoted parameters; check `runnable`: quotes without a `--to` recipient produce a template action (`runnable: false`) that still needs the recipient before execution.

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
  "explorerUrl": "https://etherscan.io/tx/0x...",
  "nextActions": [{ "command": "accounts", "reason": "...", "when": "after_ragequit", "options": { "agent": true, "chain": "mainnet" } }]
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
privacy-pools accounts --agent [--details]
privacy-pools accounts --agent --all-chains
privacy-pools accounts --agent --summary
privacy-pools accounts --agent --chain <chain> --pending-only
```

```json
{
  "chain": "all-mainnets",
  "chains": ["mainnet", "arbitrum", "optimism"],
  "accounts": [
    {
      "poolAccountNumber": 1,
      "poolAccountId": "PA-1",
      "status": "approved",
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

`status` values: `"approved"`, `"pending"`, `"poi_required"`, `"declined"`, `"unknown"`, `"spent"`, `"exited"`. `aspStatus` values: `"pending"`, `"approved"`, `"poi_required"`, `"declined"`, `"unknown"` (`"unknown"` for spent or exited accounts, or when ASP review data is unavailable). `pendingCount` is the number of accounts with `status: "pending"`.

Without `--chain`, `accounts` aggregates all CLI-supported mainnet chains by default. Use `--all-chains` to include testnets. In multi-chain responses, `poolAccountId` remains chain-local, so pair it with `chain` or `chainId`.

`balances` contains per-pool totals for Pool Accounts with remaining balance. `balance` is the total amount in wei (string). `usdValue` is a formatted USD string (or `null` when price data is unavailable).

`--summary` returns `{ chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poiRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions? }` and omits `accounts`.

`--pending-only` returns `{ chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions? }`, filters to `aspStatus: "pending"`, and omits `balances`.

After depositing, poll `accounts --agent --chain <chain> --pending-only` while the Pool Account remains pending. Reviewed entries disappear from `--pending-only` results instead of changing in place; once gone, re-run `accounts --agent --chain <chain>` to confirm whether the final status is `approved`, `declined`, or `poi_required` before choosing `withdraw` or `ragequit`. Always preserve the same `--chain` for both polling and confirmation. Bare `accounts` only covers the mainnet chains, so testnet deposits would be invisible without it. Most deposits approve within 1 hour; some may take up to 7 days. `nextActions` on `accounts` appear when pending approvals still exist.

### `migrate status`

```bash
privacy-pools migrate status --agent
privacy-pools migrate status --agent --all-chains
privacy-pools migrate status --agent --chain mainnet
```

`migrate status` is a strictly read-only legacy website migration or recovery check on CLI-supported chains. It rebuilds the legacy account view from the installed SDK, the built-in CLI pool registry for CLI-supported chains, and current onchain events without persisting trusted account or sync state, then reports whether legacy pre-upgrade commitments still need website migration, already appear fully migrated, require website-based public recovery because they were declined, or cannot be classified safely because ASP review data is incomplete.

Without `--chain`, `migrate status` checks all CLI-supported mainnet chains by default. Use `--all-chains` to include supported testnets. As with other multi-chain read-only commands, `--rpc-url` is only valid alongside `--chain <name>`. Review beta or other website-only migration surfaces in the Privacy Pools website.

```json
{
  "mode": "migration-status",
  "chain": "all-mainnets",
  "chains": ["mainnet", "arbitrum", "optimism"],
  "warnings": [
    {
      "chain": "all-mainnets",
      "category": "COVERAGE",
      "message": "This command only checks chains currently supported by the CLI. Review beta or other website-only legacy migration surfaces in the Privacy Pools website."
    }
  ],
  "status": "migration_required",
  "requiresMigration": true,
  "requiresWebsiteRecovery": false,
  "isFullyMigrated": false,
  "readinessResolved": true,
  "submissionSupported": false,
  "requiredChainIds": [1],
  "migratedChainIds": [],
  "missingChainIds": [1],
  "websiteRecoveryChainIds": [],
  "unresolvedChainIds": [],
  "chainReadiness": [
    {
      "chain": "mainnet",
      "chainId": 1,
      "status": "migration_required",
      "candidateLegacyCommitments": 1,
      "expectedLegacyCommitments": 1,
      "migratedCommitments": 0,
      "legacyMasterSeedNullifiedCount": 0,
      "hasPostMigrationCommitments": false,
      "isMigrated": false,
      "legacySpendableCommitments": 1,
      "upgradedSpendableCommitments": 0,
      "declinedLegacyCommitments": 0,
      "reviewStatusComplete": true,
      "requiresMigration": true,
      "requiresWebsiteRecovery": false,
      "scopes": ["12345"]
    }
  ]
}
```

When `readinessResolved` is `false`, treat the result as incomplete and review the account in the Privacy Pools website before acting on it. The CLI does not submit migration transactions.

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

`syncedSymbols` is present on successful sync (may be omitted on empty sync). `previousAvailablePoolAccounts` shows the count before sync; compare with `availablePoolAccounts` to detect newly discovered accounts.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `PRIVACY_POOLS_PRIVATE_KEY` | Ethereum private key (alternative to init wizard) |
| `PRIVACY_POOLS_HOME` | Override config directory (default: `~/.privacy-pools`) |
| `PRIVACY_POOLS_CONFIG_DIR` | Alias for `PRIVACY_POOLS_HOME` |
| `PRIVACY_POOLS_RPC_URL` | Override RPC URL for all chains |
| `PP_RPC_URL` | Alias for `PRIVACY_POOLS_RPC_URL` |
| `PRIVACY_POOLS_ASP_HOST` | Override ASP host for all chains |
| `PP_ASP_HOST` | Alias for `PRIVACY_POOLS_ASP_HOST` |
| `PRIVACY_POOLS_RELAYER_HOST` | Override relayer host for all chains |
| `PP_RELAYER_HOST` | Alias for `PRIVACY_POOLS_RELAYER_HOST` |
| `PRIVACY_POOLS_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PRIVACY_POOLS_RPC_URL_ARBITRUM`) |
| `PP_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PP_RPC_URL_ARBITRUM`) |
| `PRIVACY_POOLS_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PRIVACY_POOLS_ASP_HOST_SEPOLIA`) |
| `PP_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PP_ASP_HOST_SEPOLIA`) |
| `PRIVACY_POOLS_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |
| `PP_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |
| `PRIVACY_POOLS_CLI_ENABLE_NATIVE` | Legacy compatibility alias for the default native-preferred launcher behavior |
| `PRIVACY_POOLS_CLI_DISABLE_NATIVE` | Set to `1` to force the pure JS runtime path |
| `PRIVACY_POOLS_CLI_BINARY` | Override the launcher target with an explicit native shell binary path |
| `PRIVACY_POOLS_CLI_JS_WORKER` | Override the JS worker entrypoint used by the launcher/native bridge |
| `NO_COLOR` | Disable colored output (same as `--no-color`) |
| `PP_NO_UPDATE_CHECK` | Set to `1` to disable the update-available notification |
| `PRIVACY_POOLS_CIRCUITS_DIR` | Override circuit artifact cache directory (default: `~/.privacy-pools/circuits/v<sdk-version>`) |

The CLI loads `.env` from the config directory (`~/.privacy-pools/.env`), not from the current working directory. All flags take precedence over environment variables.

---

## Error format

All errors in JSON mode:

```json
{
  "schemaVersion": "1.7.0",
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
| `RPC_RATE_LIMITED` | RPC | Yes | RPC provider rate limit (429); use `--rpc-url` |
| `RPC_POOL_RESOLUTION_FAILED` | RPC | Yes | Pool resolution failed (ASP + RPC both down) |
| `ASP_ERROR` | ASP | No | ASP service failure |
| `RELAYER_ERROR` | RELAYER | No | Relayer request failure |
| `PROOF_ERROR` | PROOF | No | Proof generation failure |
| `PROOF_GENERATION_FAILED` | PROOF | No | ZK proof could not be generated |
| `PROOF_MERKLE_ERROR` | PROOF | Yes | Commitment not in Merkle tree (sync first) |
| `PROOF_MALFORMED` | PROOF | No | Corrupt proof data |
| `CONTRACT_NULLIFIER_ALREADY_SPENT` | CONTRACT | No | Pool Account already withdrawn |
| `CONTRACT_INCORRECT_ASP_ROOT` | CONTRACT | Yes | State changed, regenerate proof |
| `CONTRACT_UNKNOWN_STATE_ROOT` | CONTRACT | Yes | State root changed, regenerate proof |
| `CONTRACT_CONTEXT_MISMATCH` | CONTRACT | No | Proof context does not match withdrawal |
| `CONTRACT_INVALID_PROOF` | CONTRACT | No | Proof rejected on-chain |
| `CONTRACT_INVALID_PROCESSOOOR` | CONTRACT | No | Wrong withdrawal mode |
| `CONTRACT_INVALID_COMMITMENT` | CONTRACT | No | Selected Pool Account is no longer valid |
| `CONTRACT_PRECOMMITMENT_ALREADY_USED` | CONTRACT | No | Duplicate precommitment, retry deposit |
| `CONTRACT_ONLY_ORIGINAL_DEPOSITOR` | CONTRACT | No | Wrong signer for exit |
| `CONTRACT_NOT_YET_RAGEQUITTEABLE` | CONTRACT | Yes | Pool Account cannot be exited yet |
| `CONTRACT_MAX_TREE_DEPTH_REACHED` | CONTRACT | No | Pool has reached max deposit capacity |
| `CONTRACT_NO_ROOTS_AVAILABLE` | CONTRACT | Yes | Pool not ready, wait and retry |
| `CONTRACT_MINIMUM_DEPOSIT_AMOUNT` | CONTRACT | No | Deposit amount is below the pool minimum |
| `CONTRACT_INVALID_DEPOSIT_VALUE` | CONTRACT | No | Deposit amount is too large |
| `CONTRACT_INVALID_WITHDRAWAL_AMOUNT` | CONTRACT | No | Withdrawal amount is invalid |
| `CONTRACT_POOL_NOT_FOUND` | CONTRACT | No | Requested pool is unavailable on this chain |
| `CONTRACT_POOL_IS_DEAD` | CONTRACT | No | Pool no longer accepts activity |
| `CONTRACT_RELAY_FEE_GREATER_THAN_MAX` | CONTRACT | Yes | Relayer fee exceeds pool maximum |
| `CONTRACT_INVALID_TREE_DEPTH` | CONTRACT | No | Proof inputs do not match pool tree depth |
| `CONTRACT_NATIVE_ASSET_TRANSFER_FAILED` | CONTRACT | No | Native asset transfer to the destination failed |
| `CONTRACT_INSUFFICIENT_FUNDS` | CONTRACT | No | Wallet lacks ETH for amount + gas |
| `CONTRACT_NONCE_ERROR` | CONTRACT | Yes | Nonce conflict; pending tx may be stuck |
| `ACCOUNT_MIGRATION_REQUIRED` | INPUT | No | Legacy pre-upgrade account must be migrated in the website before CLI restore/sync |
| `ACCOUNT_WEBSITE_RECOVERY_REQUIRED` | INPUT | No | Legacy declined deposits require website-based recovery before CLI restore/sync |
| `ACCOUNT_MIGRATION_REVIEW_INCOMPLETE` | ASP | Yes | Legacy ASP review data is incomplete; retry before acting on restore/sync |
| `ACCOUNT_NOT_APPROVED` | ASP | No | Deposit is not approved for withdrawal; it may still be pending, may require Proof of Association, or may have been declined |
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
1. `RPC_NETWORK_ERROR` / `RPC_RATE_LIMITED` / `RPC_POOL_RESOLUTION_FAILED`: exponential backoff (1s, 2s, 4s), max 3 retries. For rate limits, consider switching to a dedicated RPC with `--rpc-url`.
2. `CONTRACT_INCORRECT_ASP_ROOT` / `CONTRACT_UNKNOWN_STATE_ROOT` / `PROOF_MERKLE_ERROR`: run `privacy-pools sync --agent`, then retry.
3. `CONTRACT_NO_ROOTS_AVAILABLE` / `CONTRACT_NONCE_ERROR` / `CONTRACT_RELAY_FEE_GREATER_THAN_MAX` / `CONTRACT_NOT_YET_RAGEQUITTEABLE`: wait 30-60s or request a fresh quote, then retry.

When `retryable: false`:
4. `ACCOUNT_MIGRATION_REQUIRED`: review the account in the Privacy Pools website first, migrate the legacy account there, then rerun the CLI restore or sync command.
5. `ACCOUNT_WEBSITE_RECOVERY_REQUIRED`: review the account in the Privacy Pools website first and use the website's recovery flow for declined legacy deposits, then rerun the CLI restore or sync command.
6. `ACCOUNT_MIGRATION_REVIEW_INCOMPLETE`: retry when ASP connectivity is healthy, or run `privacy-pools migrate status --agent` and wait for `readinessResolved: true` before acting on this account.
7. `ACCOUNT_NOT_APPROVED`: run `privacy-pools accounts --agent --chain <chain>` to check `aspStatus`. If it is `pending`, keep polling `privacy-pools accounts --agent --chain <chain> --pending-only`. If it is `poi_required`, complete Proof of Association at tornado.0xbow.io first. If it is `declined`, recover with `privacy-pools ragequit --chain <chain> --asset <symbol> --from-pa <PA-#>`.

---

## Supported chains

| Name | Chain ID | Testnet | Entrypoint |
|------|----------|---------|------------|
| `mainnet` | 1 | No | `0x6818809eefce719e480a7526d76bd3e561526b46` |
| `arbitrum` | 42161 | No | `0x44192215fed782896be2ce24e0bfbf0bf825d15e` |
| `optimism` | 10 | No | `0x44192215fed782896be2ce24e0bfbf0bf825d15e` |
| `sepolia` | 11155111 | Yes | `0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb` |
| `op-sepolia` | 11155420 | Yes | `0x54aca0d27500669fa37867233e05423701f11ba1` |

`ethereum` is accepted as an alias for `mainnet`.

---

## Links

- GitHub: [0xmatthewb/privacy-pools-cli](https://github.com/0xmatthewb/privacy-pools-cli)
- Privacy Pools: [https://privacypools.com](https://privacypools.com)
- 0xbow: [https://0xbow.io](https://0xbow.io)
