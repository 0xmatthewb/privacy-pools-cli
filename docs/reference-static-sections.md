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
| `workflows/` | Saved `flow` snapshots, including recipient, tx hashes, and workflow state metadata |
| `workflow-secrets/` | Per-workflow private keys for `flow --new-wallet` until the workflow completes, public-recovers, or is externally stopped |

**Environment variables:**

| Variable | Purpose |
|----------|---------|
| `PRIVACY_POOLS_HOME` | Override config directory |
| `PRIVACY_POOLS_CONFIG_DIR` | Alias for `PRIVACY_POOLS_HOME` |
| `PRIVACY_POOLS_PRIVATE_KEY` | Signer private key (takes precedence over `.signer` file) |
| `PRIVACY_POOLS_RPC_URL` | Override RPC URL for all chains |
| `PP_RPC_URL` | Alias for `PRIVACY_POOLS_RPC_URL` |
| `PRIVACY_POOLS_ASP_HOST` | Override ASP host for all chains |
| `PP_ASP_HOST` | Alias for `PRIVACY_POOLS_ASP_HOST` |
| `PRIVACY_POOLS_RELAYER_HOST` | Override relayer host for all chains |
| `PP_RELAYER_HOST` | Alias for `PRIVACY_POOLS_RELAYER_HOST` |
| `PRIVACY_POOLS_CIRCUITS_DIR` | Override the circuit artifact cache directory (default: `~/.privacy-pools/circuits/v<sdk-version>`) |
| `PRIVACY_POOLS_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PRIVACY_POOLS_RPC_URL_ARBITRUM`) |
| `PP_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PP_RPC_URL_ARBITRUM`) |
| `PRIVACY_POOLS_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PRIVACY_POOLS_ASP_HOST_SEPOLIA`) |
| `PP_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PP_ASP_HOST_SEPOLIA`) |
| `PRIVACY_POOLS_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |
| `PP_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |
| `PRIVACY_POOLS_CLI_ENABLE_NATIVE` | Legacy compatibility alias for the default native-preferred launcher behavior |
| `PRIVACY_POOLS_CLI_DISABLE_NATIVE` | Set to `1` to force the pure JS runtime path |
| `PRIVACY_POOLS_CLI_BINARY` | Override the launcher target with an explicit native shell binary path |
| `PRIVACY_POOLS_CLI_JS_WORKER` | Override the JS worker entrypoint used by the launcher/native shell bridge |
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
  runtime/        Active JS runtime descriptor plus versioned worker boundaries
    current.ts    Active worker/bridge descriptor used by the launcher
    v1/           Versioned JS worker boundary for protocol-owned logic
  services/       SDK, wallet, account, ASP, and relayer service wrappers
  utils/          Shared utilities (validation, formatting, errors, mode)
  launcher.ts     Thin launcher that resolves native vs JS runtime targets
  index.ts        npm entry point; serves root fast paths and delegates
  types.ts        Shared TypeScript types
native/
  shell/          Rust shell for manifest-driven help/discovery and approved
                  read-only paths; sensitive wallet/account state stays in JS
test/
  unit/           Unit tests for individual modules
  integration/    Integration tests (CLI invocation via subprocess)
  conformance/    Source-level grep assertions enforcing architectural rules
  fuzz/           Fuzz and stress tests
  helpers/        Shared test utilities
```

`safeReadOnly` and native execution are intentionally different concepts.
Use the generated command manifest for execution ownership; `safeReadOnly`
only describes whether the command avoids wallet-mutating flows.

For future `runtime/vN` work, follow [`docs/runtime-upgrades.md`](runtime-upgrades.md).

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

- Supported runtime range: Node >=22 <26
- CI-tested runtimes: Node 22.x, 24.x, and 25.x
- Recommended dev/CI runtime: Node 25.x
- Recommended Bun version for repo workflows: 1.3.11

### Scripts

```bash
bun run test              # fast default suite (excludes packaged smoke)
bun run test:ci           # local single-host mirror of the required CI checks
bun run test:release      # release-readiness suite (root + host artifact gates + benchmark gate + full Anvil matrix)
bun run test:smoke        # packaged CLI smoke against a packed tarball
bun run test:artifacts:host # pack/install the current-host CLI + native artifacts
bun run typecheck         # TypeScript type check (no emit)
bun run circuits:provision # prefetch proof artifacts into the CLI home
bun run test:e2e:anvil    # full Sepolia-fork E2E
bun run test:e2e:anvil:smoke # required happy-path smoke lane
bun run test:fuzz         # fuzz tests (longer timeout)
bun run test:stress       # stress test (120 rounds)
bun run test:coverage     # coverage guard for key source directories
bun run test:conformance  # live conformance against npm + public 0xbow-io GitHub sources
bun run test:conformance:frontend # focused website/frontend parity only
bun run test:conformance:all # alias for the full live conformance suite
bun run bench:gate        # native perf gate against the current checkout JS fallback
bun run bench:gate:release # native perf gate against the v1.7.0 release baseline
```

Use `bun run test`, `bun run test:ci`, and `bun run test:release` rather than bare `bun test`. The package scripts encode the intended suite split and required timeouts.

The Anvil E2E harness starts local ASP and relayer shims against a forked Sepolia state snapshot. Install Anvil via Foundry (`https://www.getfoundry.sh/anvil`) or set `PP_ANVIL_BIN` if `anvil` is not discoverable on your `PATH`.
