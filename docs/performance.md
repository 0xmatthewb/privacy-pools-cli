# Performance Benchmarking

Use the local benchmark harness to compare the current checkout against a git ref:

```bash
node scripts/bench-cli.mjs
node scripts/bench-cli.mjs --base origin/main
node scripts/bench-cli.mjs --base origin/main --runs 12
```

The harness builds both checkouts, runs a small read-only command matrix, and prints
median timing deltas. It keeps the setup intentionally lightweight:

- no extra dependencies
- no external benchmark runner
- isolated temp home for `status --json --no-check`

The default command matrix covers:

- `--help`
- `--version`
- `status --json --no-check`
- `capabilities --agent`

If you want to compare a different ref, pass `--base <ref>` such as `HEAD~1`,
`origin/main`, or a release tag.
