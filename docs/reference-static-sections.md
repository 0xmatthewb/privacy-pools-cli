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

Most chains have multiple built-in RPC URLs with automatic fallback. When using the built-in list, the CLI probes candidate URLs and selects the first healthy one. If all probes fail, it falls back to the primary URL. A user-specified `--rpc-url`, env var, or config override uses only that URL.

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

# Build the packaged CLI, then run the built entrypoint
bun run build
bun run start -- --help

# Link for local testing
bun run circuits:provision
npm link
privacy-pools --help

# Unlink when done
npm unlink -g privacy-pools-cli
```

### Runtime Requirements

- Supported runtime: Node 24.x and 25.x
- Recommended dev/CI runtime: Node 25.x
- Recommended Bun version for repo workflows: 1.3.11

### Scripts

```bash
bun run test              # fast default suite (excludes packaged smoke)
bun run test:ci           # local mirror of required CI checks
bun run test:smoke        # packaged CLI smoke against a packed tarball
bun run typecheck         # TypeScript type check (no emit)
bun run circuits:provision # prefetch proof artifacts into the CLI home
bun run test:e2e:anvil    # full Sepolia-fork E2E
bun run test:e2e:anvil:smoke # required happy-path smoke lane
bun run test:fuzz         # fuzz tests (longer timeout)
bun run test:stress       # stress test (120 rounds)
bun run test:coverage     # coverage guard for key source directories
bun run test:conformance  # core conformance tests (extended timeout)
bun run test:conformance:frontend # optional frontend parity (website access required)
bun run test:conformance:all # core conformance + frontend parity
```

Use `bun run test` / `bun run test:ci` rather than bare `bun test`. The package scripts encode the intended suite split and required timeouts.

The Anvil E2E harness starts local ASP and relayer shims against a forked Sepolia state snapshot. Install Anvil via Foundry (`https://www.getfoundry.sh/anvil`) or set `PP_ANVIL_BIN` if `anvil` is not discoverable on your `PATH`.
