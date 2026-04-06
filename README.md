# Privacy Pools CLI

Compliant privacy on Ethereum, right from your terminal. Deposit funds publicly and withdraw privately by proving you belong to an association set of approved addresses. Built for agents with machine-readable JSON on stdout.

> [!CAUTION]
> Experimental software, use at your own risk. For large transactions, use [privacypools.com](https://privacypools.com).

- **Private withdrawals:** zero-knowledge proofs break the onchain link between your deposit and withdrawal
- **Non-custodial:** exit publicly via ragequit at any time, regardless of ASP approval
- **Multi-chain:** Ethereum, Arbitrum, Optimism (+ testnets)
- **Agent-ready:** structured JSON output, unsigned transaction mode, categorized errors ([AGENTS.md](AGENTS.md))

## Getting Started

```bash
# 1. Initialize (creates a 24-word recovery phrase and signer key)
privacy-pools init

# 2. See what's available
privacy-pools pools
```

```
┌───────┬────────────────┬─────────────────┬────────────┬──────────────┬─────────────┬─────────────┐
│ Asset │ Total Deposits │ Pool Balance    │ USD Value  │ Pending      │ Min Deposit │ Vetting Fee │
├───────┼────────────────┼─────────────────┼────────────┼──────────────┼─────────────┼─────────────┤
│ ETH   │ 2,875          │ 823.92 ETH      │ $1,667,647 │ 1.20 ETH     │ 0.01 ETH    │ 0.50%       │
│ USDC  │ 351            │ 310,722 USDC    │ $310,693   │ 500 USDC     │ 25 USDC     │ 0.50%       │
│ USDT  │ 78             │ 105,544 USDT    │ $105,540   │ 0 USDT       │ 25 USDT     │ 0.00%       │
│ ...   │                │                 │            │              │             │             │
└───────┴────────────────┴─────────────────┴────────────┴──────────────┴─────────────┴─────────────┘
```

```bash
# 3. Easy path: deposit now, save the later private withdrawal, and resume when ready
privacy-pools flow start 0.1 ETH --to 0xRecipient...
privacy-pools flow watch                     # or pass --watch to flow start
privacy-pools flow status latest            # inspect the saved workflow later
privacy-pools flow ragequit latest          # optional public recovery once the deposit exists; canonical if declined or private completion is no longer possible

# 4. Manual path: deposit into a pool
privacy-pools deposit 0.1 ETH

# 5. Wait for ASP approval (most deposits are approved within 1 hour, but some may take longer: up to 7 days)
privacy-pools accounts --chain mainnet --pending-only   # poll while the deposit remains pending
privacy-pools accounts --chain mainnet                  # confirm approved vs declined vs PoA-needed before next step

# 6. Withdraw privately to any address
privacy-pools withdraw 0.05 ETH --to 0xRecipient...
```

### How it works

`flow start` deposits into a pool and saves a local workflow. Once the Association Set Provider (ASP) approves it, `flow watch` waits through a privacy delay before requesting the relayed private withdrawal. Most deposits are approved within 1 hour, but some may take longer (up to 7 days). You can always recover your funds publicly via `ragequit`, even without ASP approval.

The manual commands (`deposit`, `accounts`, `withdraw`) remain available for partial withdrawals, custom Pool Account selection, unsigned payloads, or dry-runs. See [docs/reference.md](docs/reference.md) for details.

> [!TIP]
> Restoring an existing wallet? Use `--mnemonic-file` or `--mnemonic-stdin` instead of inline `--mnemonic`.

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
| `stats` | Protocol statistics (global or per-pool) | |
| `status` | Configuration and connectivity health | |
| `describe` | Describe one command (for agents or quick reference) | |
| `capabilities` | Describe all CLI commands, flags, and workflows | |
| `guide` | Print the full usage guide | |
| `upgrade` | Check npm for updates or upgrade this CLI | |
| `init` | Set up wallet and config (run once) | |
| `flow` | Guided deposit-to-private-withdrawal workflow | Yes |
| `deposit` | Deposit funds into a Privacy Pool | Yes |
| `withdraw` | Privately withdraw funds via relayer | Yes |
| `ragequit` | Public recovery to your deposit address (alias: `exit`) | Yes |
| `accounts` | List Pool Accounts with balances and approval status | Yes |
| `migrate` | Read-only legacy migration or recovery readiness on supported chains | Yes |
| `history` | Chronological event log | Yes |
| `sync` | Force-sync account state from onchain | Yes |
| `completion` | Generate shell completions (bash/zsh/fish/powershell) | |

Most commands accept `--chain <name>` to override your default chain. `stats global` is the exception because it is always cross-chain. For detailed flags, examples, and JSON payloads, see [docs/reference.md](docs/reference.md).

## Agent / Machine Mode

Pass `--agent` (shorthand for `--json --yes --quiet`) for structured JSON on stdout, no prompts, no banners:

```bash
privacy-pools flow start 0.1 ETH --to 0xRecipient... --agent
privacy-pools flow start 100 USDC --to 0xRecipient... --new-wallet --export-new-wallet ./flow-wallet.txt --agent
privacy-pools flow watch latest --agent
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
