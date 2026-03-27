# Performance Benchmarking

Use the local benchmark harness to compare the current checkout against a git ref:

```bash
node scripts/bench-cli.mjs
node scripts/bench-cli.mjs --base origin/main
node scripts/bench-cli.mjs --base origin/main --runs 12
node scripts/bench-cli.mjs --runtime native
node scripts/bench-cli.mjs --runtime both --runs 6
```

The harness builds both checkouts, runs a read-only command matrix, and prints
median timing deltas. Base timings always use the JS fallback path so native
preview branches can be compared directly against the current npm baseline.

Use `--runtime js` for the pure JS launcher path, `--runtime native` for the
launcher + native shell path, or `--runtime both` to print both lanes in one
report.

The `native` lane still includes `status --json --no-check`, but that command
is intentionally JS-owned for the fund-safety boundary. Its native timing
therefore measures launcher + native-shell forwarding overhead rather than a
Rust implementation.

It keeps the setup intentionally lightweight:

- no extra dependencies
- no external benchmark runner
- isolated temp home for `status --json --no-check`
- local fixture-backed ASP/RPC paths for public read-only commands

The default command matrix covers:

- `--help`
- `--version`
- `capabilities --agent`
- `describe withdraw quote --agent`
- `flow --help`
- `migrate --help`
- `status --json --no-check`
- `pools --agent --chain sepolia`
- `activity --agent`
- `stats --agent`
- `stats pool --agent --chain sepolia --asset ETH`

If you want to compare a different ref, pass `--base <ref>` such as `HEAD~1`,
`origin/main`, or a release tag.
