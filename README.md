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
