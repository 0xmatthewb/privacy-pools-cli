# Privacy Pools CLI

Command-line interface for interacting with Privacy Pools v1.

## Installation

Global install (adds `privacy-pools` to your shell `PATH`):

```bash
npm i -g @0xbow/privacy-pools-cli
# or
bun add -g @0xbow/privacy-pools-cli
```

One-off execution (no install):

```bash
npx @0xbow/privacy-pools-cli@latest --help
# or
bunx @0xbow/privacy-pools-cli@latest --help
```

## Basic Usage

```bash
privacy-pools --help
privacy-pools init
privacy-pools status
```

Command-specific help:

```bash
privacy-pools <command> --help
```

## Human vs Agent Modes

Human (default interactive flow):

```bash
privacy-pools init
privacy-pools pools --chain sepolia
privacy-pools deposit ETH 0.1 --chain sepolia
privacy-pools accounts --chain sepolia
privacy-pools accounts --all --chain sepolia
privacy-pools withdraw ETH 0.05 --to 0xRecipient -p PA-1 --chain sepolia
privacy-pools exit ETH -p PA-1 --chain sepolia
```

Agent mode (machine-readable and non-interactive):

```bash
privacy-pools --json --yes status
privacy-pools --json --yes deposit ETH 0.1 --unsigned --chain sepolia
privacy-pools --json --yes withdraw ETH 0.05 --to 0xRecipient -p PA-1 --chain sepolia
privacy-pools --json --yes exit ETH -p PA-1 --chain sepolia
```

Mode concepts:

- Human mode (default): readable output and prompts
- Agent mode: `-j -y` (or `--json --yes`) for machine output without prompts
- Pool Accounts are surfaced as `PA-1`, `PA-2`, ... (matching the web app)
- Use `-p` / `--from-pa` on `withdraw` / `exit` for explicit account selection
- Modifiers: `--unsigned` (build payloads only), `--dry-run` (validate/generate without submitting), `-q/--quiet` (minimal chatter)
- Compatibility alias: `--agent` is equivalent to `-j -y -q` (kept for existing automation)

## Running From Source (Local Development)

```bash
bun install
bun run dev -- --help
bun run dev -- init
bun run dev -- status
```

`bun run dev` runs the CLI entrypoint directly (`bun src/index.ts`), but it does not install the `privacy-pools` command into your shell.  
If you want to run `privacy-pools ...` directly from a local checkout, link it:

```bash
bun run build
npm link
privacy-pools --help
```

Unlink later with:

```bash
npm unlink -g @0xbow/privacy-pools-cli
```

## Shell Completion

Generate a completion script for your shell:

```bash
privacy-pools completion zsh
privacy-pools completion bash
privacy-pools completion fish
```

Typical install paths:

```bash
# zsh
privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools

# bash
privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools

# fish
privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish
```

## Tests

```bash
bun test
```
