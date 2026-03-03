# Privacy Pools CLI

Command-line interface for [Privacy Pools v1](https://www.privacypools.com). Deposit, withdraw, and manage funds with onchain privacy — without sacrificing regulatory compliance.

> **Warning:** This CLI is experimental. Use at your own risk. For large transactions, use [privacypools.com](https://privacypools.com).

## What is Privacy Pools?

On public blockchains, every transaction is visible to everyone. While transparency is a core feature, it means every transfer reveals the full balances and history of both parties.

Privacy Pools enables private withdrawals through zero-knowledge proofs and commitment schemes. You deposit assets into a pool and later withdraw them — partially or fully — without creating an onchain link between your deposit and withdrawal addresses. An Association Set Provider (ASP) maintains a set of approved deposits, preventing illicit funds from entering the system while preserving privacy for compliant users.

The protocol is **non-custodial**: you maintain control of your funds through cryptographic commitments at all times.

**Key concepts:**

- **Pool Account (PA-1, PA-2, ...)**: Each deposit creates a numbered Pool Account — this is how you refer to your funds throughout the CLI.
- **ASP (Association Set Provider)**: A compliance layer that screens deposits and maintains a Merkle tree of approved labels. Your Pool Account must be ASP-approved before you can withdraw privately.
- **Relayed withdrawal**: The default mode. A relayer submits your transaction so there is no onchain link between your wallet and the recipient. Costs a small fee.
- **Direct withdrawal**: You submit the withdrawal yourself. Cheaper, but provides weaker privacy because your wallet appears onchain.
- **Ragequit / Exit**: A safety mechanism that lets the original depositor publicly reclaim funds without ASP approval — useful if your deposit hasn't been approved or approval was revoked.

## Installation

Install globally:

```bash
npm i -g github:0xmatthewb/privacy-pools-cli
# or
bun add -g github:0xmatthewb/privacy-pools-cli
```

Installed command names:

- `privacy-pools` (canonical)
- `pp` (short alias)

Or run from source:

```bash
git clone https://github.com/0xmatthewb/privacy-pools-cli.git
cd privacy-pools-cli
bun install
bun run dev -- --help
```

## Quick Start

```bash
# 1. Initialize your wallet (generates a mnemonic and signer key)
privacy-pools init
# shorthand:
pp init

# 2. See what pools are available
privacy-pools pools --chain sepolia

# 3. Deposit into a pool
privacy-pools deposit 0.1 --asset ETH --chain sepolia

# 4. Check your Pool Accounts (wait for ASP approval before withdrawing)
privacy-pools accounts --chain sepolia

# 5. Withdraw to any address (relayed by default, stronger privacy)
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... -p PA-1 --chain sepolia
```

After depositing, your Pool Account will show `aspStatus: pending` until the ASP approves it. Once approved, you can withdraw. Most deposits are approved within 1 hour, but some can take up to 7 days.

## Supported Chains

| Chain | Chain ID | Type |
|-------|----------|------|
| `mainnet` | 1 | Mainnet |
| `arbitrum` | 42161 | Mainnet |
| `optimism` | 10 | Mainnet |
| `sepolia` | 11155111 | Testnet |
| `op-sepolia` | 11155420 | Testnet |

Set the chain per-command with `--chain <name>`, or set a default during `init`. The default chain is `mainnet`.

Each chain has multiple built-in RPC URLs with automatic fallback. If the primary RPC endpoint is unreachable, the CLI transparently retries with a fallback URL. You can still override with `--rpc-url`.

## Commands

### `init`

Initialize wallet and configuration. Generates a BIP-39 mnemonic (your deposit secrets) and a signer key (your onchain identity). Run once.

```bash
privacy-pools init
privacy-pools init --default-chain sepolia
privacy-pools init --mnemonic-file ./my-mnemonic.txt --private-key-file ./my-key.txt
```

| Flag | Description |
|------|-------------|
| `--default-chain <chain>` | Set default chain |
| `--mnemonic <phrase>` | Import existing BIP-39 phrase (unsafe: visible in process list) |
| `--mnemonic-file <path>` | Import BIP-39 phrase from a file |
| `--private-key <key>` | Set signer private key (unsafe: visible in process list) |
| `--private-key-file <path>` | Set signer private key from a file |
| `--force` | Overwrite existing config without prompting |
| `--show-mnemonic` | Include mnemonic in JSON output (unsafe) |

During interactive setup, `init` offers to write a recovery backup to `~/privacy-pools-recovery.txt`. It also asks you to confirm that you've securely backed up your recovery phrase before proceeding. Circuit artifacts are downloaded automatically on first use.

### `pools`

List available Privacy Pools on a chain. When no `--chain` is specified, shows all mainnets (mainnet, arbitrum, optimism). Use `--all-chains` to include testnets.

```bash
privacy-pools pools                    # all mainnets
privacy-pools pools --chain sepolia    # specific chain
privacy-pools pools --all-chains       # all chains including testnets
```

### `deposit`

Deposit into a pool.

```bash
privacy-pools deposit 0.1 --asset ETH --chain sepolia
privacy-pools deposit ETH 0.1 --chain sepolia          # asset-first syntax also works
privacy-pools deposit 100 --asset USDC --chain mainnet
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Asset to deposit (e.g., `ETH`, `USDC`, or a contract address) |
| `--unsigned` | Build unsigned transaction payload(s) without submitting |
| `--unsigned-format <format>` | Output format for `--unsigned`: `envelope` (default) or `tx` |
| `--dry-run` | Validate and preview the deposit without submitting |

### `withdraw`

Withdraw from a pool. Uses a relayer by default for stronger privacy. Add `--direct` to withdraw directly to your signer address instead.

```bash
# Relayed withdrawal (default, stronger privacy)
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... -p PA-1 --chain sepolia

# Direct withdrawal (cheaper, weaker privacy than relayed)
privacy-pools withdraw 0.05 --asset ETH --direct --chain sepolia

# Get a fee quote without withdrawing
privacy-pools withdraw quote 0.1 --asset ETH --to 0xRecipient... --chain sepolia
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Asset to withdraw |
| `-t, --to <address>` | Recipient address (required for relayed withdrawals) |
| `-p, --from-pa <PA-#\|#>` | Withdraw from a specific Pool Account (e.g., `PA-2` or `2`) |
| `--direct` | Use direct withdrawal instead of relayed |
| `--unsigned` | Build unsigned payload(s) without submitting |
| `--unsigned-format <format>` | Output format: `envelope` (default) or `tx` |
| `--dry-run` | Generate and verify withdrawal proof without submitting |

### `accounts`

List your Pool Accounts with balances, ASP approval status, and account lifecycle info.

```bash
privacy-pools accounts --chain sepolia
privacy-pools accounts --all                  # include spent and exited accounts
privacy-pools accounts --details              # show commitment hashes, labels, and tx info
```

| Flag | Description |
|------|-------------|
| `--no-sync` | Skip syncing account state before displaying |
| `--all` | Include exited and fully spent Pool Accounts |
| `--details` | Show low-level commitment details (hash, label, block, tx) |

**Pool Account statuses:** `spendable` (can withdraw), `spent` (fully withdrawn), `exited` (ragequit).
**ASP statuses:** `approved` (can withdraw privately), `pending` (waiting for ASP), `unknown`.

### `history`

Show chronological event history (deposits, withdrawals, exits).

```bash
privacy-pools history --chain sepolia
privacy-pools history --limit 10
```

| Flag | Description |
|------|-------------|
| `--no-sync` | Skip syncing account state |
| `-n, --limit <n>` | Show last N events (default: 50) |

### `sync`

Sync local account state from onchain events. Most commands sync automatically, but you can run this manually after a failed transaction or to force a refresh.

```bash
privacy-pools sync --chain sepolia
privacy-pools sync --asset ETH     # sync a single pool
```

### `ragequit` (alias: `exit`)

Emergency public exit mechanism that returns funds to your deposit address and sacrifices privacy. Use this if the ASP hasn't approved your deposit, or if you need your funds back immediately.

```bash
privacy-pools ragequit --asset ETH -p PA-1 --chain sepolia
privacy-pools exit ETH -p PA-1 --chain sepolia              # same thing
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Asset pool to exit from |
| `-p, --from-pa <PA-#\|#>` | Pool Account to exit |
| `--unsigned` | Build unsigned payload without submitting |
| `--unsigned-format <format>` | Output format: `envelope` (default) or `tx` |
| `--dry-run` | Generate proof and validate without submitting |

### `status`

Show wallet configuration and connection health.

```bash
privacy-pools status
privacy-pools status --check           # test both RPC and ASP connectivity
privacy-pools status --check-rpc       # test RPC only
privacy-pools status --check-asp       # test ASP only
privacy-pools status --no-check        # skip all connectivity checks
```

### `guide`

Print the full usage guide, workflow overview, and reference.

```bash
privacy-pools guide
```

### `capabilities`

Describe all CLI commands, flags, and workflows in a structured format. Visible in `--help`. Useful for agent/tool discovery.

```bash
privacy-pools capabilities --json
```

### `activity`

Show the public activity feed — recent deposits, withdrawals, and exits — either globally or for a specific pool. When no `--chain` is specified, shows global activity across all chains.

```bash
privacy-pools activity                                 # all mainnets
privacy-pools activity --chain sepolia                 # specific chain
privacy-pools activity --asset ETH --chain sepolia     # filter to one pool
privacy-pools activity --page 2 --limit 20             # pagination
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Filter to one pool asset |
| `--page <n>` | Page number (default: 1) |
| `--limit <n>` | Items per page (default: 12) |

### `stats`

Show public protocol statistics (all-time and last 24h). Has two subcommands: `global` and `pool`. `stats global` shows aggregate cross-chain statistics when no `--chain` is specified.

```bash
privacy-pools stats global                            # all mainnets
privacy-pools stats global --chain sepolia            # specific chain
privacy-pools stats pool --asset ETH --chain sepolia  # per-pool stats
```

| Subcommand | Flag | Description |
|------------|------|-------------|
| `global` | — | Show aggregate statistics across all pools |
| `pool` | `-a, --asset <symbol\|address>` | Show statistics for a specific pool |

### `completion`

Generate shell completion scripts.

```bash
# zsh
privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools

# bash
privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools

# fish
privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish
```

## Global Options

These flags work on every command:

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | `-j` | Machine-readable JSON output on stdout |
| `--yes` | `-y` | Skip confirmation prompts |
| `--chain <name>` | `-c` | Target chain (`mainnet`, `arbitrum`, `optimism`, `sepolia`, `op-sepolia`) |
| `--rpc-url <url>` | `-r` | Override RPC URL for the chain |
| `--quiet` | `-q` | Suppress non-essential stderr output |
| `--verbose` | `-v` | Enable verbose/debug output |
| `--no-banner` | | Disable ASCII banner |
| `--agent` | | Machine-friendly mode (alias for `--json --yes --quiet`) |
| `--timeout <seconds>` | | Network/transaction timeout in seconds |

## Agent / Machine Mode

For automation, scripts, and AI agents, use `--json --yes` (or `--agent`) to get structured JSON on stdout with no interactive prompts.

**Typical agent workflow:**

```bash
# 1. Initialize
privacy-pools init -j -y --default-chain sepolia

# 2. Discover pools
privacy-pools pools -j --chain sepolia

# 3. Deposit
privacy-pools deposit 0.1 --asset ETH -j -y --chain sepolia

# 4. Poll for ASP approval
privacy-pools accounts -j --chain sepolia
# → wait until aspStatus is "approved"

# 5. Withdraw
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... -j -y --chain sepolia
```

**Output stream convention:**

- **stdout** — reserved exclusively for machine-readable JSON (when `--json` is set). Never contains human-readable text.
- **stderr** — all human-readable messages (progress spinners, prompts, status lines, errors).

This means you can safely pipe stdout to `jq` or another parser without worrying about stray text.

**JSON output contract:**

Every command emits a JSON object on stdout when `--json` is set:

```json
// Success
{ "schemaVersion": "1.3.0", "success": true, ...payload }

// Error
{ "schemaVersion": "1.3.0", "success": false, "errorCode": "RPC_ERROR", "errorMessage": "...", "error": { "code": "RPC_ERROR", "category": "RPC", "message": "...", "hint": "...", "retryable": true } }
```

**Exit codes:**

| Code | Category | Meaning |
|------|----------|---------|
| 0 | — | Success |
| 1 | UNKNOWN | General error |
| 2 | INPUT | Invalid input or validation failure |
| 3 | RPC | RPC / network error |
| 4 | ASP | ASP service error |
| 5 | RELAYER | Relayer service error |
| 6 | PROOF | ZK proof generation error |
| 7 | CONTRACT | On-chain contract revert |

## Unsigned Transactions

Build transaction payloads offline without submitting. Useful for external signing workflows and air-gapped signing.

```bash
# Envelope format (default): includes metadata and proof artifacts
privacy-pools deposit 0.1 --asset ETH --unsigned -j --chain sepolia

# Raw tx format: just the transaction objects, ready to sign and broadcast
privacy-pools deposit 0.1 --asset ETH --unsigned --unsigned-format tx -j --chain sepolia

# Works with withdraw and ragequit too
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... --unsigned -j --chain sepolia
privacy-pools ragequit --asset ETH -p PA-1 --unsigned -j --chain sepolia
```

## Dry Run

Validate inputs, check balances, and generate proofs without submitting anything onchain.

```bash
privacy-pools deposit 0.1 --asset ETH --dry-run --chain sepolia
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... --dry-run --chain sepolia
privacy-pools ragequit --asset ETH -p PA-1 --dry-run --chain sepolia
```

## Configuration

Configuration is stored in `~/.privacy-pools/` by default. Override with the `PRIVACY_POOLS_HOME` or `PRIVACY_POOLS_CONFIG_DIR` environment variable.

**Files:**

| File | Purpose |
|------|---------|
| `config.json` | Default chain, RPC overrides |
| `.mnemonic` | BIP-39 mnemonic (mode 0600), protects your deposit secrets |
| `.signer` | Private key (mode 0600), your onchain identity |
| `accounts/` | Per-chain account state (synced from onchain events) |

**Environment variables:**

| Variable | Purpose |
|----------|---------|
| `PRIVACY_POOLS_HOME` | Override config directory |
| `PRIVACY_POOLS_PRIVATE_KEY` | Signer private key (takes precedence over `.signer` file) |
| `PRIVACY_POOLS_ASP_HOST` | Override ASP host for all chains |
| `PRIVACY_POOLS_RELAYER_HOST` | Override relayer host for all chains |
| `PP_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PP_RPC_URL_ARBITRUM`) |
| `PP_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PP_ASP_HOST_SEPOLIA`) |
| `PP_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |

## Project Structure

```
src/
  commands/       Command handlers (one per CLI command)
  output/         Output renderers — own all JSON payload assembly and
                  human-mode formatting. Commands delegate here.
    common.ts     Shared OutputContext, isSilent(), re-exported primitives
    mod.ts        Barrel re-export of all renderers
    <command>.ts  Per-command renderer (e.g., deposit.ts, withdraw.ts)
  config/         Chain configuration and contract addresses
  services/       SDK, wallet, account, ASP, and relayer service wrappers
  utils/          Shared utilities (validation, formatting, errors, mode)
  index.ts        Entry point — registers all commands
  types.ts        Shared TypeScript types
test/
  unit/           Unit tests for individual modules
  integration/    Integration tests (CLI invocation via subprocess)
  conformance/    Source-level grep assertions enforcing architectural rules
  fuzz/           Fuzz and stress tests
  helpers/        Shared test utilities
```

## Development

```bash
# Run from source
bun install
bun run dev -- --help
bun run dev -- init
bun run dev -- status

# Build and link for local testing
bun run build
npm link
privacy-pools --help

# Unlink when done
npm unlink -g privacy-pools-cli
```

### Scripts

```bash
bun test                  # full test suite
bun run typecheck         # TypeScript type check (no emit)
bun run test:fuzz         # fuzz tests (longer timeout)
bun run test:stress       # stress test (120 rounds)
bun run test:coverage     # test suite with coverage
bun run test:conformance  # conformance tests (extended timeout)
bun run test:release      # full release gate (e2e + external conformance)
```

## License

Apache-2.0
