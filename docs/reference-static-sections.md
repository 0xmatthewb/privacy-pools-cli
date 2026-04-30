## Unsigned Transactions

Build transaction payloads offline without submitting. Useful for external signing workflows and air-gapped signing.

```bash
# Envelope format (default): includes metadata and proof artifacts
privacy-pools deposit 0.1 ETH --unsigned --json

# Raw tx format: just the transaction objects, ready to sign and broadcast
privacy-pools deposit 0.1 ETH --unsigned tx --json

# Works with withdraw and ragequit too
privacy-pools withdraw 0.05 ETH --to 0xRecipient... --unsigned --json
privacy-pools ragequit ETH --pool-account PA-1 --unsigned --json
```

## Dry Run

Validate inputs, check balances, and generate proofs without submitting anything onchain.

```bash
privacy-pools deposit 0.1 ETH --dry-run
privacy-pools withdraw 0.05 ETH --to 0xRecipient... --dry-run
privacy-pools ragequit ETH --pool-account PA-1 --dry-run
```

## CSV Support

CSV output is intentionally limited to listing and read-only reporting commands
with tabular data. Write commands do not support CSV because their JSON
envelopes carry transaction, proof, and safety metadata that should not be
flattened.

| Command | CSV |
|---------|-----|
| `pools` | Yes |
| `pools activity` | Yes |
| `pools stats` | Yes |
| `pools show` | No |
| `accounts` | Yes |
| `history` | Yes |
| `recipients list` | Yes |
| `deposit` | No |
| `withdraw` | No |
| `ragequit` | No |
| `flow` | No |
| `init` | No |

## Installation Notes

For agents and automation, prefer `npm i -g privacy-pools-cli` on a supported
host. The root npm package installs cleanly without unpublished host-native
packages; supported hosts use native acceleration when a release includes the
matching native package or `PRIVACY_POOLS_CLI_BINARY` points to a verified
native shell.

Unsupported hosts such as Linux musl/Alpine still fall back safely to JS by
design. If a supported published install falls back to JS because the native
shell is missing or invalid, `status --agent` includes the warning code
`native_acceleration_unavailable`. The CLI remains fully functional, but
read-only discovery commands may be slower until a release with the host package
is installed or an explicit native binary override is configured.

## Configuration

Configuration is stored in `~/.privacy-pools/` by default. Override with `PRIVACY_POOLS_HOME` or `PRIVACY_POOLS_CONFIG_DIR`. If neither override is set and no legacy `~/.privacy-pools/` directory exists, `$XDG_CONFIG_HOME/privacy-pools/` is used when `XDG_CONFIG_HOME` is set.

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
| `XDG_CONFIG_HOME` | Fallback config base when no Privacy Pools override or legacy config directory exists |
| `PRIVACY_POOLS_PRIVATE_KEY` | Signer private key (takes precedence over `.signer` file) |
| `PRIVACY_POOLS_RPC_URL` | Override RPC URL for all chains |
| `PP_RPC_URL` | Alias for `PRIVACY_POOLS_RPC_URL` |
| `PRIVACY_POOLS_ASP_HOST` | Override ASP host for all chains |
| `PP_ASP_HOST` | Alias for `PRIVACY_POOLS_ASP_HOST` |
| `PRIVACY_POOLS_RELAYER_HOST` | Override relayer host for all chains |
| `PP_RELAYER_HOST` | Alias for `PRIVACY_POOLS_RELAYER_HOST` |
| `PRIVACY_POOLS_CIRCUITS_DIR` | Override the circuit artifact directory. By default the CLI uses bundled packaged artifacts. Set this only if you already have a trusted pre-provisioned directory |
| `PRIVACY_POOLS_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PRIVACY_POOLS_RPC_URL_ARBITRUM`) |
| `PP_RPC_URL_<CHAIN>` | Per-chain RPC override (e.g., `PP_RPC_URL_ARBITRUM`) |
| `PRIVACY_POOLS_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PRIVACY_POOLS_ASP_HOST_SEPOLIA`) |
| `PP_ASP_HOST_<CHAIN>` | Per-chain ASP override (e.g., `PP_ASP_HOST_SEPOLIA`) |
| `PRIVACY_POOLS_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |
| `PP_RELAYER_HOST_<CHAIN>` | Per-chain relayer override |
| `PRIVACY_POOLS_CLI_DISABLE_NATIVE` | Set to `1` to force the pure JS runtime path |
| `PRIVACY_POOLS_CLI_BINARY` | Advanced maintainer override for the launcher target; point it at an explicit native shell binary path |
| `PRIVACY_POOLS_CLI_JS_WORKER` | Advanced maintainer override for the JS worker entrypoint; it must point at a real packaged JS worker file |
| `NO_COLOR` | Disable colored output (same as `--no-color`) |
| `FORCE_COLOR` | Force colored output when supported by the terminal renderer |
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
npm ci
npm run dev -- --help
npm run dev -- init
npm run dev -- status

# Build the packaged CLI, then run the built entrypoint
npm run build
npm run start -- --help

# Link for local testing
node scripts/provision-circuits.mjs   # source checkout only: materialize bundled proof artifacts into the CLI home
npm link
privacy-pools --help

# Unlink when done
npm unlink -g privacy-pools-cli
```

### Runtime Requirements

- Supported runtime range: Node >=22 <26
- CI-tested runtimes: Node 22.x, 24.x, and 25.x
- Recommended dev/CI runtime: Node 25.x
- Bun is internal test tooling only. The supported CLI runtime is Node.js.

### Scripts

```bash
npm run test              # fast default suite (excludes packed and native-shell smoke)
npm run test:ci           # local single-host mirror of the required CI checks
npm run test:release      # release-readiness suite (root + host artifact gates + benchmark gate + full Anvil matrix)
npm run test:packed-smoke # packed CLI smoke against a packed tarball
npm run test:smoke        # compatibility alias for test:packed-smoke
npm run test:artifacts:host # pack/install the current-host CLI + native artifacts
npm run typecheck         # TypeScript type check (no emit)
npm run test:e2e:anvil    # full Sepolia-fork E2E
npm run test:e2e:anvil:smoke # required happy-path smoke lane
npm run test:fuzz         # fuzz tests (longer timeout)
npm run test:stress       # stress test (120 rounds)
npm run test:coverage     # coverage guard for key source directories
npm run test:conformance  # core conformance against npm + public 0xbow-io sources
npm run test:conformance:frontend # focused website/frontend parity only
npm run test:conformance:all # full live conformance suite, including frontend parity
npm run bench:gate        # native perf gate against the current checkout JS fallback
npm run bench:gate:release # native perf gate against the v2.0.0 release baseline
```

Repo-only helper (source checkout only):

```bash
node scripts/provision-circuits.mjs # materialize bundled proof artifacts into the CLI home
```

When working from a source checkout, use the package scripts above. Installed npm packages ship the `privacy-pools` binary and bundled docs, not the repository helper scripts. Bun remains an internal test-runner implementation detail, but the maintainer contract is still `npm run ...`.

The Anvil E2E harness starts local ASP and relayer shims against a forked Sepolia state snapshot. Install Anvil via Foundry (`https://www.getfoundry.sh/anvil`) or set `PP_ANVIL_BIN` if `anvil` is not discoverable on your `PATH`.
