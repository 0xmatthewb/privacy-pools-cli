# CLI Reference

Detailed command reference for the Privacy Pools CLI. For a quick overview, see the [README](../README.md). For agent integration, see [AGENTS.md](../AGENTS.md).

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

During interactive setup, `init` offers to write a recovery backup to `~/privacy-pools-recovery.txt`. Proof commands automatically provision circuit artifacts on first use when needed, caching them under `~/.privacy-pools/circuits/v<sdk-version>` by default.

### `pools`

List available Privacy Pools on a chain. When no `--chain` is specified, shows all mainnets (mainnet, arbitrum, optimism). Use `--all-chains` to include testnets. Pools are sorted by pool balance (highest first) by default.

```bash
privacy-pools pools                    # all mainnets, sorted by pool balance
privacy-pools pools --chain mainnet    # specific chain
privacy-pools pools --all-chains       # all chains including testnets
privacy-pools pools ETH                # detail view: stats, your funds, recent activity
```

### `deposit`

Deposit assets (ETH or ERC20 tokens) into a pool, creating a private commitment.

```bash
privacy-pools deposit 0.1 --asset ETH
privacy-pools deposit 100 --asset USDC
privacy-pools deposit 0.1 ETH
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Asset to deposit (e.g., `ETH`, `USDC`, or a contract address) |
| `--unsigned [format]` | Build unsigned payload; format: `envelope` (default) or `tx` |
| `--dry-run` | Validate and preview the deposit without submitting |
| `--ignore-unique-amount` | Bypass the unique amount privacy guard |

**Privacy guard:** Non-round deposit amounts can fingerprint your deposit in the anonymity set. The CLI warns and blocks deposits with excessive decimal precision (e.g., `1.276848 ETH`), suggesting nearby round alternatives. Use `--ignore-unique-amount` to override.

### `withdraw`

Withdraw from a pool. Uses a relayer by default for enhanced privacy (the relayer pays gas and takes a fee). Add `--direct` to interact with the pool contract directly (no relayer fees, but not privacy-preserving).

```bash
# Relayed withdrawal (default, enhanced privacy)
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... --from-pa PA-1

# Withdraw entire balance
privacy-pools withdraw --all --asset ETH --to 0xRecipient...

# Withdraw a percentage
privacy-pools withdraw 50% --asset ETH --to 0xRecipient...

# Direct withdrawal (no relayer fees, not privacy-preserving)
privacy-pools withdraw 0.05 --asset ETH --direct

# Get a fee quote without withdrawing
privacy-pools withdraw quote 0.1 --asset ETH --to 0xRecipient...
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Asset to withdraw |
| `-t, --to <address>` | Recipient address (required for relayed withdrawals) |
| `-p, --from-pa <PA-#\|#>` | Withdraw from a specific Pool Account (e.g., `PA-2` or `2`) |
| `--all` | Withdraw entire Pool Account balance |
| `--extra-gas / --no-extra-gas` | Request gas tokens with ERC20 withdrawal (default: true) |
| `--direct` | Use direct withdrawal instead of relayed |
| `--unsigned [format]` | Build unsigned payload; format: `envelope` (default) or `tx` |
| `--dry-run` | Generate and verify withdrawal proof without submitting |

**Privacy hint:** Non-round withdrawal amounts may be identifiable. The CLI suggests round alternatives for better privacy.

### `accounts`

List your Pool Accounts with balances, ASP approval status, and account lifecycle info.

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

Force-sync local account state from onchain events. Most commands auto-sync with a 2-minute freshness window.

```bash
privacy-pools sync
privacy-pools sync --asset ETH     # sync a single pool
```

### `ragequit` (alias: `exit`)

Emergency withdrawal without ASP approval. The original depositor can publicly reclaim funds when the deposit label is not approved. Falls back to a built-in pool registry when public pool discovery is unavailable.

```bash
privacy-pools ragequit --asset ETH --from-pa PA-1
privacy-pools exit --asset ETH --from-pa PA-1
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Asset pool to exit from |
| `-p, --from-pa <PA-#\|#>` | Pool Account to exit |
| `--unsigned [format]` | Build unsigned payload; format: `envelope` (default) or `tx` |
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

Describe all CLI commands, flags, and workflows in a structured format. Useful for agent/tool discovery.

```bash
privacy-pools capabilities --json
```

### `activity`

Show the public activity feed (recent deposits, withdrawals, and exits).

```bash
privacy-pools activity                                 # all mainnets
privacy-pools activity --chain mainnet                # specific chain
privacy-pools activity --asset ETH --chain mainnet    # filter to one pool
privacy-pools activity --page 2 --limit 20             # pagination
```

| Flag | Description |
|------|-------------|
| `-a, --asset <symbol\|address>` | Filter to one pool asset |
| `--page <n>` | Page number (default: 1) |
| `--limit <n>` | Items per page (default: 12) |

### `stats`

Show public protocol statistics. Subcommands: `global` and `pool`.

```bash
privacy-pools stats global                            # all mainnets (aggregated)
privacy-pools stats pool --asset ETH --chain mainnet  # per-pool stats
```

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

## Unsigned Transactions

Build transaction payloads offline without submitting. Useful for external signing workflows and air-gapped signing.

```bash
# Envelope format (default): includes metadata and proof artifacts
privacy-pools deposit 0.1 --asset ETH --unsigned --json

# Raw tx format: just the transaction objects, ready to sign and broadcast
privacy-pools deposit 0.1 --asset ETH --unsigned tx --json

# Works with withdraw and ragequit too
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... --unsigned --json
privacy-pools ragequit --asset ETH --from-pa PA-1 --unsigned --json
```

## Dry Run

Validate inputs, check balances, and generate proofs without submitting anything onchain.

```bash
privacy-pools deposit 0.1 --asset ETH --dry-run
privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... --dry-run
privacy-pools ragequit --asset ETH --from-pa PA-1 --dry-run
```

## Exit Codes

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

## Configuration

Configuration is stored in `~/.privacy-pools/` by default. Override with `PRIVACY_POOLS_HOME` or `PRIVACY_POOLS_CONFIG_DIR`.

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

## RPC Fallback

Each chain has multiple built-in RPC URLs with automatic fallback. Before each operation, the CLI probes candidate URLs and selects the first healthy one. If all probes fail, it falls back to the primary URL. Override with `--rpc-url`.

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
PP_ANVIL_E2E=1 bun run test:e2e:anvil # opt-in Sepolia-fork E2E
bun run test:fuzz         # fuzz tests (longer timeout)
bun run test:stress       # stress test (120 rounds)
bun run test:coverage     # test suite with coverage
bun run test:conformance  # conformance tests (extended timeout)
```

Use `bun run test` / `bun run test:ci` rather than bare `bun test`. The package scripts encode the intended suite split and required timeouts.

The Anvil E2E harness starts local ASP and relayer shims against a forked Sepolia state snapshot. Install Anvil via Foundry (`https://www.getfoundry.sh/anvil`) or set `PP_ANVIL_BIN` if `anvil` is not discoverable on your `PATH`.
