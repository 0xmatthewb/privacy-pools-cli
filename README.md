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
# 1. Initialize (creates a recovery phrase and signer key)
privacy-pools init

# 2. See what's available
privacy-pools pools
```

```
┌───────┬────────────────┬─────────────────┬────────────┬─────────────┬─────────────┐
│ Asset │ Total Deposits │ Pool Balance    │ USD Value  │ Min Deposit │ Vetting Fee │
├───────┼────────────────┼─────────────────┼────────────┼─────────────┼─────────────┤
│ ETH   │ 2,875          │ 823.92 ETH      │ $1,667,647 │ 0.01 ETH    │ 0.50%       │
│ USDC  │ 351            │ 310,722 USDC    │ $310,693   │ 25 USDC     │ 0.50%       │
│ USDT  │ 78             │ 105,544 USDT    │ $105,540   │ 25 USDT     │ 0.00%       │
│ ...   │                │                 │            │             │             │
└───────┴────────────────┴─────────────────┴────────────┴─────────────┴─────────────┘
```

```bash
# 3. Deposit into a pool
privacy-pools deposit 0.1 ETH

# 4. Wait for ASP approval (most < 1 hour, up to 7 days)
privacy-pools accounts --chain mainnet --pending-only   # poll while the deposit remains pending
privacy-pools accounts --chain mainnet                  # confirm approved vs declined vs PoA-needed before next step

# 5. Withdraw privately to any address
privacy-pools withdraw 0.05 ETH --to 0xRecipient...
```

Each deposit creates a **Pool Account** (PA-1, PA-2, ...) that 0xbow's Association Set Provider (ASP) reviews. Once approved, you can withdraw privately through a relayer with no onchain connection to your deposit. If a deposit is marked `poi_required`, complete Proof of Association before withdrawing privately. If it is declined, the recovery path is `ragequit`, which exits publicly to your deposit address.

You can recover your funds at any time, even if your deposit isn't approved. `privacy-pools ragequit ETH --from-pa PA-1` exits publicly to your deposit address.

## Install

```bash
npm i -g github:0xmatthewb/privacy-pools-cli
# or: bun add -g github:0xmatthewb/privacy-pools-cli
```

Or run from source:

```bash
git clone https://github.com/0xmatthewb/privacy-pools-cli.git
cd privacy-pools-cli && bun install
bun run dev -- pools

# Built checkout entrypoint
bun run build
bun run start -- --help
```

## Runtime Requirements

- Supported runtime: Node 22.x, 24.x, and 25.x
- Recommended dev/CI runtime: Node 25.x
- Recommended Bun version for repo workflows: 1.3.11

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
| `init` | Set up wallet and config (run once) | |
| `deposit` | Deposit into a pool | Yes |
| `withdraw` | Withdraw from a pool (relayed or direct) | Yes |
| `ragequit` | Emergency exit without ASP approval (alias: `exit`) | Yes |
| `accounts` | List Pool Accounts with balances and approval status | Yes |
| `history` | Chronological event log | Yes |
| `sync` | Force-sync account state from onchain | Yes |
| `completion` | Generate shell completions (bash/zsh/fish/powershell) | |

All commands accept `--chain <name>` to override your default chain. For detailed flags, examples, and JSON payloads, see [docs/reference.md](docs/reference.md).

## Agent / Machine Mode

Pass `--agent` (shorthand for `--json --yes --quiet`) for structured JSON on stdout, no prompts, no banners:

```bash
privacy-pools deposit 0.1 ETH --agent
privacy-pools accounts --agent --chain mainnet --pending-only   # poll while the deposit remains pending; preserve the same --chain on other networks
privacy-pools withdraw 0.05 ETH --to 0xRecipient --agent
```

Every response is wrapped in a versioned envelope:

```json
{ "schemaVersion": "1.5.0", "success": true, ...commandPayload }
{ "schemaVersion": "1.5.0", "success": false, "errorCode": "INPUT_ERROR", "errorMessage": "..." }
```

stdout is always JSON. stderr carries human-readable output. Pipe safely to `jq`.

For unsigned transaction payloads, error taxonomy, and the full integration guide: [AGENTS.md](AGENTS.md).

## Further Reading

- [docs/reference.md](docs/reference.md): flags, configuration, environment variables, project structure
- [AGENTS.md](AGENTS.md): agent integration guide, JSON payloads, unsigned mode
- [CHANGELOG.md](CHANGELOG.md): release history and migration notes

Supported chains: Ethereum mainnet, Arbitrum, Optimism, Sepolia, OP Sepolia.

## License

Apache-2.0
