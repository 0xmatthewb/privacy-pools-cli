# Privacy Pools CLI

Command-line interface for [Privacy Pools v1](https://www.privacypools.com), a compliant way to transact anonymously on Ethereum. Deposit, withdraw privately, manage pool accounts, and more. Built for AI agent integration with structured JSON output, categorized errors, and unsigned transaction mode.

> **Warning:** This CLI is experimental. Use at your own risk. For large transactions, use [privacypools.com](https://privacypools.com).

## What is Privacy Pools?

On public blockchains like Ethereum, every transaction is visible to everyone. While this transparency is a core feature, it creates significant privacy challenges for users. Every transaction reveals the full balances and transaction history of both parties.

Privacy Pools enables private withdrawals through a combination of zero-knowledge proofs and commitment schemes. Users can deposit assets into a pool and later withdraw them, either partially or fully, without creating an onchain link between their deposit and withdrawal addresses. The protocol uses an Association Set Provider (ASP) to maintain a set of approved deposits, preventing potentially illicit funds from entering the system and enabling regulatory compliance.

The protocol is **non-custodial**: users maintain control of their funds through cryptographic commitments.

**Key concepts:**

- **Pool Account (PA-1, PA-2, ...)**: Each deposit creates a numbered Pool Account. This is how you refer to your funds throughout the CLI.
- **ASP (Association Set Provider)**: The compliance layer that controls which deposits can be privately withdrawn. Maintains approved labels and supplies cryptographic proof data for withdrawals.
- **Relayed withdrawal**: The withdrawal is processed through a relayer for enhanced privacy. The relayer pays gas and takes a configurable fee. No onchain link between your wallet and the recipient.
- **Direct withdrawal**: The user directly interacts with the pool contract. Simpler flow and no relayer fees, but not privacy-preserving because the user's wallet appears onchain.
- **Ragequit / Exit**: A safety mechanism that allows the original depositor to publicly withdraw funds without needing ASP approval. Ensures the ability to recover funds when the deposit label is not approved by the ASP or its approval was revoked.

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
privacy-pools pools

# 3. Deposit into a pool
privacy-pools deposit 0.1 ETH

# 4. Check your Pool Accounts (wait for ASP approval before withdrawing)
privacy-pools accounts

# 5. Withdraw to any address (relayed by default, enhanced privacy)
privacy-pools withdraw 0.05 ETH --to 0xRecipient... -p PA-1
```

Commands use your default chain (set during `init`). Add `--chain <name>` to override.

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

Each chain has multiple built-in RPC URLs with automatic fallback. Before each operation, the CLI probes candidate URLs and selects the first healthy one. If all probes fail, it falls back to the primary URL so you still get the natural error. You can override with `--rpc-url`.

## Commands

### `init`

Initialize wallet and configuration. Generates a BIP-39 mnemonic (used to derive deposit commitments) and a signer key (your onchain identity). Run once.

```bash
privacy-pools init
privacy-pools init --default-chain mainnet
privacy-pools init --mnemonic-file ./my-mnemonic.txt --private-key-file ./my-key.txt
```

| Flag | Description |
|------|-------------|
| `--default-chain <chain>` | Set default chain |
| `--mnemonic <phrase>` | Import existing BIP-39 phrase (unsafe: visible in process list) |
| `--mnemonic-file <path>` | Import BIP-39 phrase from a file (raw phrase or Privacy Pools backup file) |
| `--private-key <key>` | Set signer private key (unsafe: visible in process list) |
| `--private-key-file <path>` | Set signer private key from a file |
| `--force` | Overwrite existing config without prompting |
| `--show-mnemonic` | Include mnemonic in JSON output (unsafe) |

During interactive setup, `init` offers to write a recovery backup to `~/privacy-pools-recovery.txt`. It also asks you to confirm that you've securely backed up your recovery phrase before proceeding. Proof commands automatically provision circuit artifacts on first use when needed, caching them under `~/.privacy-pools/circuits/v<sdk-version>` by default and verifying them against the shipped checksum manifest before use.

### `pools`

List available Privacy Pools on a chain. When no `--chain` is specified, shows all mainnets (mainnet, arbitrum, optimism). Use `--all-chains` to include testnets. Pools are sorted by pool balance (highest first) by default.

```bash
privacy-pools pools                    # all mainnets, sorted by pool balance
privacy-pools pools --chain mainnet    # specific chain
privacy-pools pools --all-chains       # all chains including testnets
privacy-pools pools ETH                # detail view: stats, your funds, recent activity
```

### `deposit`

Deposit assets (ETH or ERC20 tokens) into a pool, creating a private commitment that can later be used for private withdrawals or emergency exits.

```bash
privacy-pools deposit 0.1 ETH
privacy-pools deposit ETH 0.1                          # asset-first syntax also works
privacy-pools deposit 100 USDC
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Asset to deposit (e.g., `ETH`, `USDC`, or a contract address) |
| `--unsigned` | Build unsigned transaction payload(s) without submitting |
| `--unsigned-format <format>` | Output format for `--unsigned`: `envelope` (default) or `tx` |
| `--dry-run` | Validate and preview the deposit without submitting |

### `withdraw`

Withdraw from a pool. Uses a relayer by default for enhanced privacy (the relayer pays gas and takes a fee). Add `--direct` to interact with the pool contract directly (no relayer fees, but not privacy-preserving).

```bash
# Relayed withdrawal (default, enhanced privacy)
privacy-pools withdraw 0.05 ETH --to 0xRecipient... -p PA-1

# Withdraw entire balance
privacy-pools withdraw --all ETH --to 0xRecipient...

# Withdraw a percentage
privacy-pools withdraw 50% ETH --to 0xRecipient...

# Direct withdrawal (no relayer fees, not privacy-preserving)
privacy-pools withdraw 0.05 ETH --direct

# Get a fee quote without withdrawing
privacy-pools withdraw quote 0.1 ETH --to 0xRecipient...
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Asset to withdraw |
| `-t, --to <address>` | Recipient address (required for relayed withdrawals) |
| `-p, --from-pa <PA-#\|#>` | Withdraw from a specific Pool Account (e.g., `PA-2` or `2`) |
| `--all` | Withdraw entire Pool Account balance |
| `--extra-gas / --no-extra-gas` | Request gas tokens with ERC20 withdrawal (default: true). Ignored for native ETH |
| `--direct` | Use direct withdrawal instead of relayed |
| `--unsigned` | Build unsigned payload(s) without submitting |
| `--unsigned-format <format>` | Output format: `envelope` (default) or `tx` |
| `--dry-run` | Generate and verify withdrawal proof without submitting |

### `accounts`

List your Pool Accounts with balances, ASP approval status, and account lifecycle info. Includes per-pool balance totals (in the table footer for human output, and in a `balances` array for JSON output).

```bash
privacy-pools accounts
privacy-pools accounts --all                  # include spent and exited accounts
privacy-pools accounts --details              # show commitment hashes, labels, and tx info
```

| Flag | Description |
|------|-------------|
| `--no-sync` | Skip syncing account state before displaying |
| `--all` | Include exited and fully spent Pool Accounts |
| `--details` | Show low-level commitment details (hash, label, block, tx) |

**Pool Account statuses:** `spendable` (can withdraw), `spent` (fully withdrawn), `exited` (exit/ragequit).
**ASP statuses:** `approved` (can withdraw privately), `pending` (waiting for ASP), `unknown`.

### `history`

Show chronological event history (deposits, withdrawals, exits). Auto-syncs in the background.

```bash
privacy-pools history
privacy-pools history --limit 10
```

| Flag | Description |
|------|-------------|
| `--no-sync` | Skip syncing account state |
| `-n, --limit <n>` | Show last N events (default: 50) |

### `sync`

Force-sync local account state from onchain events. Most commands auto-sync in the background (with a 2-minute freshness window), so you rarely need this. Use it after a failed transaction or to force a refresh.

```bash
privacy-pools sync
privacy-pools sync --asset ETH     # sync a single pool
```

### `ragequit` (alias: `exit`)

A safety mechanism that allows the original depositor to publicly withdraw funds without needing ASP approval. Use when the deposit label is not approved by the ASP or its approval was revoked. Asset resolution still works when public pool discovery is offline or incomplete because the CLI falls back to a built-in pool registry verified on-chain.

```bash
privacy-pools ragequit ETH -p PA-1
privacy-pools exit ETH -p PA-1                         # same thing
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

Show the public activity feed (recent deposits, withdrawals, and exits), either globally or for a specific pool. When no `--chain` is specified, shows global activity across all chains. When filtering by `--chain` without `--asset`, events are filtered client-side and pagination totals (`total`, `totalPages`) are unavailable.

```bash
privacy-pools activity                                 # all mainnets
privacy-pools activity --chain mainnet                # specific chain (pagination totals unavailable)
privacy-pools activity --asset ETH --chain mainnet    # filter to one pool (server-side, full pagination)
privacy-pools activity --page 2 --limit 20             # pagination
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Filter to one pool asset |
| `--page <n>` | Page number (default: 1) |
| `--limit <n>` | Items per page (default: 12) |

### `stats`

Show public protocol statistics (all-time and last 24h). Has two subcommands: `global` and `pool`. `stats global` always shows aggregate cross-chain statistics; use `stats pool --asset <symbol> --chain <chain>` for chain-specific data.

```bash
privacy-pools stats global                            # all mainnets (aggregated)
privacy-pools stats pool --asset ETH --chain mainnet  # per-pool stats
```

| Subcommand | Flag | Description |
|------------|------|-------------|
| `global` | | Show aggregate statistics across all chains (does not accept `--chain`) |
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
| `--format <fmt>` | | Output format: `table` (default), `csv`, `json` |
| `--yes` | `-y` | Skip confirmation prompts |
| `--chain <name>` | `-c` | Target chain (`mainnet`, `arbitrum`, `optimism`, `sepolia`, `op-sepolia`) |
| `--rpc-url <url>` | `-r` | Override RPC URL for the chain |
| `--quiet` | `-q` | Suppress non-essential stderr output |
| `--verbose` | `-v` | Enable verbose/debug output |
| `--no-banner` | | Disable ASCII banner |
| `--no-color` | | Disable colored output (also respects `NO_COLOR` env var) |
| `--agent` | | Machine-friendly mode (alias for `--json --yes --quiet`) |
| `--timeout <seconds>` | | Network/transaction timeout in seconds |

## Agent / Machine Mode

For automation, scripts, and AI agents, use `--json --yes` (or `--agent`) to get structured JSON on stdout with no interactive prompts.

**Typical agent workflow:**

```bash
# 1. Initialize
privacy-pools init -j -y --default-chain mainnet

# 2. Discover pools
privacy-pools pools -j

# 3. Deposit
privacy-pools deposit 0.1 ETH -j -y

# 4. Poll for ASP approval
privacy-pools accounts -j
# → wait until aspStatus is "approved"

# 5. Withdraw
privacy-pools withdraw 0.05 ETH --to 0xRecipient... -j -y
```

**Output stream convention:**

- **stdout** is reserved exclusively for machine-readable JSON (when `--json` is set). It never contains human-readable text.
- **stderr** carries all human-readable messages (progress spinners, prompts, status lines, errors).

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
| 0 | | Success |
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
privacy-pools deposit 0.1 ETH --unsigned -j

# Raw tx format: just the transaction objects, ready to sign and broadcast
privacy-pools deposit 0.1 ETH --unsigned --unsigned-format tx -j

# Works with withdraw and exit too
privacy-pools withdraw 0.05 ETH --to 0xRecipient... --unsigned -j
privacy-pools ragequit ETH -p PA-1 --unsigned -j
```

## Dry Run

Validate inputs, check balances, and generate proofs without submitting anything onchain.

```bash
privacy-pools deposit 0.1 ETH --dry-run
privacy-pools withdraw 0.05 ETH --to 0xRecipient... --dry-run
privacy-pools ragequit ETH -p PA-1 --dry-run
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
| `PRIVACY_POOLS_CIRCUITS_DIR` | Override the circuit artifact cache directory |
| `PP_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PP_RPC_URL_ARBITRUM`) |
| `PP_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PP_ASP_HOST_SEPOLIA`) |
| `PP_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |
| `NO_COLOR` | Disable colored output (same as `--no-color`) |
| `PP_NO_UPDATE_CHECK` | Set to `1` to disable the update-available notification |

## Project Structure

```
src/
  commands/       Command handlers (one per CLI command)
  output/         Output renderers (JSON payload assembly and
                  human-mode formatting). Commands delegate here.
    common.ts     Shared OutputContext, isSilent(), re-exported primitives
    mod.ts        Barrel re-export of all renderers
    <command>.ts  Per-command renderer (e.g., deposit.ts, withdraw.ts)
  config/         Chain configuration and contract addresses
  services/       SDK, wallet, account, ASP, and relayer service wrappers
  utils/          Shared utilities (validation, formatting, errors, mode)
  index.ts        Entry point; registers all commands
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
bun run circuits:provision
npm link
privacy-pools --help

# Unlink when done
npm unlink -g privacy-pools-cli
```

### Scripts

```bash
bun run test              # fast default suite (unit/integration/fuzz/services)
bun run test:ci           # full suite + conformance
bun run typecheck         # TypeScript type check (no emit)
bun run circuits:provision # prefetch proof artifacts into the CLI home
PP_ANVIL_E2E=1 bun run test:e2e:anvil # opt-in Sepolia-fork E2E (deposit, relayed/direct withdraw, ragequit)
bun run test:fuzz         # fuzz tests (longer timeout)
bun run test:stress       # stress test (120 rounds)
bun run test:coverage     # test suite with coverage
bun run test:conformance  # conformance tests (extended timeout)
```

Use `bun run test` / `bun run test:ci` rather than bare `bun test`. The package scripts encode the intended suite split and required timeouts. Bare `bun test` invokes Bun's test runner directly with auto-discovery and default timeout behavior, which is not the contract this repo documents. The `npm` equivalents still work because they call the same package scripts.

The Anvil E2E harness starts local ASP and relayer shims against a forked Sepolia state snapshot. Set `PP_ANVIL_FORK_URL` to override the fork RPC URL and `PP_ANVIL_BIN` if `anvil` is not discoverable on your `PATH`.

## License

Apache-2.0
