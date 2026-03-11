# Privacy Pools CLI

Command-line interface for [Privacy Pools v1](https://www.privacypools.com) — deposit, withdraw privately, and manage pool accounts on Ethereum and L2s. Built for both interactive use and AI agent integration.

> **Warning:** This CLI is experimental. Use at your own risk. For large transactions, use [privacypools.com](https://privacypools.com).

**Features:**

- Private withdrawals via zero-knowledge proofs and relayed transactions
- Non-custodial — funds are controlled by your cryptographic commitments
- Multi-chain: mainnet, Arbitrum, Optimism (+ testnets)
- Structured JSON output and unsigned transaction mode for agent integration
- Shell completions (bash, zsh, fish)

## Getting Started

```bash
# 1. Initialize (generates recovery phrase + signer key)
privacy-pools init

# 2. Browse available pools
privacy-pools pools

# 3. Deposit into a pool
privacy-pools deposit 0.1 ETH

# 4. Check your Pool Accounts (poll until ASP approves your deposit)
privacy-pools accounts

# 5. Withdraw privately to any address
privacy-pools withdraw 0.05 ETH --to 0xRecipient...
```

After depositing, your Pool Account shows `aspStatus: pending` until the ASP approves it (usually within 1 hour, up to 7 days in rare cases). Once approved, you can withdraw.

**Key concepts:**

- **Pool Account (PA-1, PA-2, ...)** — each deposit creates a numbered Pool Account
- **ASP (Association Set Provider)** — compliance layer that approves deposits for private withdrawal
- **Relayed withdrawal** — processed through a relayer for enhanced privacy (default)
- **Direct withdrawal** — interacts with the contract directly (no relayer fees, but not privacy-preserving)
- **Ragequit / Exit** — emergency withdrawal without ASP approval, reveals deposit address

## Installation

```bash
npm i -g github:0xmatthewb/privacy-pools-cli
# or
bun add -g github:0xmatthewb/privacy-pools-cli
```

Installed command: `privacy-pools`

Or run from source:

```bash
git clone https://github.com/0xmatthewb/privacy-pools-cli.git
cd privacy-pools-cli
bun install
bun run dev -- --help
```

## Commands

| Command | Description | Requires init? |
|---------|-------------|----------------|
| `pools` | List available pools (supports `--all-chains`) | No |
| `activity` | Public activity feed | No |
| `stats global` / `stats pool` | Protocol statistics | No |
| `status` | Configuration and health check | No |
| `capabilities` | Machine-readable CLI manifest | No |
| `describe` | Describe one command for agent introspection | No |
| `guide` | Print usage guide | No |
| `init` | Initialize wallet and config | No |
| `deposit` | Deposit into a pool | Yes |
| `withdraw` | Withdraw from a pool (relayed or direct) | Yes |
| `ragequit` / `exit` | Emergency withdrawal without ASP approval | Yes |
| `accounts` | List Pool Accounts with balances and status | Yes |
| `history` | Chronological event history | Yes |
| `sync` | Force-sync local account state | Yes |
| `completion` | Generate shell completion scripts | No |

For detailed flag reference, examples, and JSON payloads, see [docs/reference.md](docs/reference.md).

## Agent / Machine Mode

Pass `--agent` (alias for `--json --yes --quiet`) for structured JSON on stdout with no prompts:

```bash
privacy-pools init --agent --default-chain mainnet
privacy-pools pools --agent
privacy-pools deposit 0.1 ETH --agent
privacy-pools accounts --agent          # poll until aspStatus: "approved"
privacy-pools withdraw 0.05 ETH --to 0xRecipient --agent
```

**Output convention:** stdout is reserved for JSON (when `--json` is set). stderr carries all human-readable output. This means you can safely pipe stdout to `jq`.

**JSON envelope:**

```json
{ "schemaVersion": "1.2.0", "success": true, ...payload }
{ "schemaVersion": "1.2.0", "success": false, "errorCode": "...", "errorMessage": "...", "error": { ... } }
```

For the full agent integration guide, see [AGENTS.md](AGENTS.md). For skill-aware agents, see [skills/](skills/privacy-pools-cli/).

## Supported Chains

| Chain | Chain ID | Type |
|-------|----------|------|
| `mainnet` | 1 | Mainnet |
| `arbitrum` | 42161 | Mainnet |
| `optimism` | 10 | Mainnet |
| `sepolia` | 11155111 | Testnet |
| `op-sepolia` | 11155420 | Testnet |

Set per-command with `--chain <name>`, or set a default during `init`.

## Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | `-j` | Machine-readable JSON output on stdout |
| `--yes` | `-y` | Skip confirmation prompts |
| `--agent` | | Machine-friendly mode (`--json --yes --quiet`) |
| `--chain <name>` | `-c` | Target chain |
| `--rpc-url <url>` | `-r` | Override RPC URL |
| `--quiet` | `-q` | Suppress non-essential stderr output |
| `--verbose` | `-v` | Enable verbose/debug output |
| `--no-banner` | | Disable ASCII banner |
| `--no-color` | | Disable colored output (also respects `NO_COLOR`) |
| `--format <fmt>` | | Output format: `table`, `csv`, `json` |
| `--timeout <seconds>` | | Network/transaction timeout |

## Further Reading

- [docs/reference.md](docs/reference.md) — full command reference, configuration, environment variables, development guide
- [AGENTS.md](AGENTS.md) — agent integration guide with JSON payloads and error handling
- [CHANGELOG.md](CHANGELOG.md) — release history

## License

Apache-2.0
