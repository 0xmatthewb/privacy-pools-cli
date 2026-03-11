# Privacy Pools CLI

Private transactions on Ethereum, from your terminal. Deposit into a pool, wait for compliance approval, withdraw to any address — no onchain link between deposit and withdrawal. Your keys, your funds, the protocol handles the rest.

> [!CAUTION]
> Experimental software. Start small. For larger amounts, use [privacypools.com](https://privacypools.com).

- **Private withdrawals** — zero-knowledge proofs break the onchain link between your deposit and withdrawal
- **Non-custodial** — your funds, your keys, your recovery phrase
- **Multi-chain** — Ethereum, Arbitrum, Optimism (+ testnets)
- **Privacy guardrails** — warns when deposit amounts could fingerprint you, suggests rounder alternatives
- **Agent-ready** — structured JSON output, unsigned transaction mode, categorized errors ([AGENTS.md](AGENTS.md))

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
│ DAI   │ 5              │ 780 DAI         │ $780       │ 250 DAI     │ 0.00%       │
│ ...   │                │                 │            │             │             │
└───────┴────────────────┴─────────────────┴────────────┴─────────────┴─────────────┘
```

```bash
# 3. Deposit into a pool
privacy-pools deposit 0.1 ETH

# 4. Wait for compliance approval (most < 1 hour, up to 7 days)
privacy-pools accounts            # poll until aspStatus: "approved"

# 5. Withdraw privately to any address
privacy-pools withdraw 0.05 ETH --to 0xRecipient...
```

Each deposit creates a **Pool Account** (PA-1, PA-2, ...) that the ASP (Association Set Provider) reviews for compliance. Once approved, you can withdraw privately through a relayer — no onchain connection to your deposit.

Need to recover funds without ASP approval? `privacy-pools ragequit ETH --from-pa PA-1` exits publicly to your deposit address.

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
```

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
| `completion` | Generate shell completions (bash/zsh/fish) | |

All commands accept `--chain <name>` to override your default chain. For detailed flags, examples, and JSON payloads, see [docs/reference.md](docs/reference.md).

## Agent / Machine Mode

Pass `--agent` (shorthand for `--json --yes --quiet`) for structured JSON on stdout, no prompts, no banners:

```bash
privacy-pools deposit 0.1 ETH --agent
privacy-pools accounts --agent          # poll until aspStatus: "approved"
privacy-pools withdraw 0.05 ETH --to 0xRecipient --agent
```

Every response is wrapped in a versioned envelope:

```json
{ "schemaVersion": "1.2.0", "success": true, ...commandPayload }
{ "schemaVersion": "1.2.0", "success": false, "errorCode": "INPUT_ERROR", "errorMessage": "..." }
```

stdout is always JSON. stderr carries human-readable output. Pipe safely to `jq`.

For unsigned transaction payloads, error taxonomy, and the full integration guide: [AGENTS.md](AGENTS.md).

## Further Reading

- [docs/reference.md](docs/reference.md) — flags, configuration, environment variables, project structure
- [AGENTS.md](AGENTS.md) — agent integration guide, JSON payloads, unsigned mode
- [CHANGELOG.md](CHANGELOG.md) — release history and migration notes

Supported chains: Ethereum mainnet, Arbitrum, Optimism, Sepolia, OP Sepolia.

## License

Apache-2.0
