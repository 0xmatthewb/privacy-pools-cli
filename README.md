# Privacy Pools CLI

Compliant privacy on Ethereum, right from your terminal. Deposit funds publicly and withdraw privately by proving you belong to an association set of approved addresses. Built for agents with machine-readable JSON on stdout.

> [!CAUTION]
> Experimental software, use at your own risk. For large transactions, use [privacypools.com](https://privacypools.com).

- **Private withdrawals:** zero-knowledge proofs break the onchain link between your deposit and withdrawal
- **Non-custodial:** exit publicly via ragequit at any time, regardless of ASP approval
- **Multi-chain:** Ethereum, Arbitrum, Optimism (+ testnets)
- **Agent-ready:** structured JSON output, unsigned transaction mode, categorized errors ([AGENTS.md](AGENTS.md))

## Getting Started

### New account

```bash
privacy-pools init       # creates a recovery phrase and saves it locally
privacy-pools pools      # browse available pools and assets
```

### Agent / CI quick start

```bash
privacy-pools init --agent --default-chain mainnet --backup-file ./privacy-pools-recovery.txt
privacy-pools status --agent --chain mainnet
privacy-pools pools --agent --chain mainnet
```

### Already have a privacypools.com account?

```bash
privacy-pools init       # select "Load an existing Privacy Pools account" when prompted
```

### Deposit and withdraw privately

```bash
privacy-pools flow start 0.1 ETH --to 0xRecipient...
privacy-pools flow watch                   # waits for ASP approval + privacy delay, then withdraws
privacy-pools flow status latest           # check progress any time
```

`flow start` deposits into a pool, and `flow watch` handles the rest: it waits for the Association Set Provider (ASP) to approve your deposit, observes a privacy delay, then requests a relayed private withdrawal. Most deposits are approved within 1 hour, but some may take up to 7 days.

### Individual commands

For more control, use the commands directly:

```bash
privacy-pools deposit 0.1 ETH                        # deposit into a pool
privacy-pools accounts --chain mainnet                # check approval status
privacy-pools withdraw 0.05 ETH --to 0xRecipient...  # withdraw privately
privacy-pools ragequit latest                         # public recovery (works even without ASP approval)
```

See [docs/reference.md](docs/reference.md) for the full flag reference.

## Install

```bash
npm i -g privacy-pools-cli

# unreleased/source builds
npm i -g github:0xmatthewb/privacy-pools-cli
```

## Distribution

The public npm package is `privacy-pools-cli`. It installs the JS launcher and,
when available, an exact-version optional native shell package for your host OS.

| Human OS | Native package |
|---------|----------------|
| macOS (Apple Silicon) | `@0xmatthewb/privacy-pools-cli-native-macos-arm64` |
| macOS (Intel) | `@0xmatthewb/privacy-pools-cli-native-macos-x64` |
| Linux (x64, glibc) | `@0xmatthewb/privacy-pools-cli-native-linux-x64-gnu` |
| Windows (x64, MSVC) | `@0xmatthewb/privacy-pools-cli-native-windows-x64-msvc` |
| Windows (ARM64, MSVC) | `@0xmatthewb/privacy-pools-cli-native-windows-arm64-msvc` |

Linux native packaging currently targets x64 glibc hosts. Alpine and other
musl-based environments fall back to the JS launcher automatically.

Or run from source:

```bash
git clone https://github.com/0xmatthewb/privacy-pools-cli.git
cd privacy-pools-cli && npm ci
npm run dev -- pools

# Built checkout entrypoint
npm run build
npm run start -- --help
```

## Runtime Requirements

- Supported runtime range: Node >=22 <26
- CI-tested runtimes: Node 22.x, 24.x, and 25.x
- Recommended dev/CI runtime: Node 25.x

## Commands

| Command | Description | Wallet required? |
|---------|-------------|:---:|
| `pools` | Browse available pools and assets | |
| `activity` | Public activity feed | |
| `protocol-stats` | Aggregate cross-chain protocol statistics | |
| `pool-stats` | Per-pool statistics for one asset | |
| `status` | Configuration and connectivity health | |
| `tx-status` | Check async transaction submission status | |
| `config` | View and manage CLI configuration | |
| `describe` | Describe one command or schema path (for agents or quick reference) | |
| `capabilities` | Describe all CLI commands, flags, and workflows | |
| `guide` | Print the full usage guide | |
| `upgrade` | Check npm for updates or upgrade this CLI | |
| `init` | Create, load, or finish setting up your account | |
| `flow` | Guided deposit-to-private-withdrawal workflow | Yes |
| `simulate` | Preview deposit, withdraw, and ragequit without submitting | |
| `deposit` | Deposit funds into a Privacy Pool | Yes |
| `withdraw` | Privately withdraw funds via relayer | Yes |
| `recipients` | Manage remembered withdrawal recipients | |
| `ragequit` | Public recovery to your deposit address (alias: `exit`) | Yes |
| `broadcast` | Broadcast a signed envelope or relayer request built elsewhere | |
| `accounts` | List Pool Accounts with balances and approval status | Yes |
| `migrate` | Read-only legacy migration or recovery readiness on supported chains | Yes |
| `history` | Chronological event log | Yes |
| `sync` | Force-sync account state from onchain | Yes |
| `stats` | Deprecated compatibility namespace for protocol and pool stats | |
| `completion` | Generate shell completions (bash/zsh/fish/powershell) | |

Most commands accept `--chain <name>` to override your default chain. `protocol-stats` is the exception because it is always cross-chain; use `pool-stats <symbol> --chain <chain>` for chain-specific stats. For detailed flags, examples, and JSON payloads, see [docs/reference.md](docs/reference.md).

## Agent / Machine Mode

Pass `--agent` (shorthand for `--json --yes --quiet`) for structured JSON on stdout, no prompts, no banners:

```bash
privacy-pools flow start 0.1 ETH --to 0xRecipient... --agent
privacy-pools flow start 100 USDC --to 0xRecipient... --new-wallet --export-new-wallet ./flow-wallet.txt --agent
privacy-pools flow status latest --agent
privacy-pools flow step latest --agent
privacy-pools flow ragequit latest --agent
privacy-pools deposit 0.1 ETH --agent
privacy-pools accounts --agent --chain mainnet --pending-only   # poll while the deposit remains pending; preserve the same --chain on other networks
privacy-pools withdraw 0.05 ETH --to 0xRecipient --agent
```

`flow` is the persisted easy path for demos and common happy-path usage. `--new-wallet` stays scoped to `flow` only; it does not change the manual command surfaces. The manual commands above remain unchanged for advanced control.

Most structured responses are wrapped in a versioned envelope:

```json
{ "schemaVersion": "<semver>", "success": true, ...commandPayload }
{ "schemaVersion": "<semver>", "success": false, "errorCode": "INPUT_ERROR", "errorMessage": "..." }
```

The main exception is `--unsigned tx`, which emits a raw transaction array instead of the envelope. stdout is always machine-readable JSON. stderr carries human-readable output. Pipe safely to `jq`.

For unsigned transaction payloads, error taxonomy, and the full integration guide: [AGENTS.md](AGENTS.md).

## Further Reading

- [docs/reference.md](docs/reference.md): flags, configuration, environment variables, project structure
- [docs/runtime-upgrades.md](docs/runtime-upgrades.md): native runtime troubleshooting, fallback controls, upgrade playbook
- [AGENTS.md](AGENTS.md): agent integration guide, JSON payloads, unsigned mode
- [CHANGELOG.md](CHANGELOG.md): release history and migration notes

Supported chains: Ethereum mainnet, Arbitrum, Optimism, Sepolia, OP Sepolia.

## License

Apache-2.0
