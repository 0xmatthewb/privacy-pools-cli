# Performance Benchmarking

Use the local benchmark harness to compare the current checkout against a git ref:

```bash
node scripts/bench-cli.mjs
node scripts/bench-cli.mjs --base origin/main
node scripts/bench-cli.mjs --base origin/main --runs 12
node scripts/bench-cli.mjs --runtime native
node scripts/bench-cli.mjs --runtime launcher-native
node scripts/bench-cli.mjs --runtime both --runs 6
node scripts/bench-cli.mjs --runtime all --runs 6
npm run bench:gate
npm run bench:gate:release
```

The harness builds both checkouts, runs a read-only command matrix, and prints
median timing deltas. Base timings always use the JS fallback path so native
preview branches can be compared directly against the current npm baseline.

Use `--runtime js` for the pure JS launcher path, `--runtime native` for the
direct Rust shell path, `--runtime launcher-native` for the shipped JS launcher
plus native shell path, `--runtime both` to print the JS and direct-native
lanes together, or `--runtime all` to print every lane in one report.

The `js` lane still includes `status --json --no-check`, but that command is
intentionally JS-owned for the fund-safety boundary and is not part of the
enforced native shell gate.

It keeps the setup intentionally lightweight:

- no extra dependencies
- no external benchmark runner
- isolated temp home for `status --json --no-check` in the JS lane
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

The enforced `bench:gate` thresholds apply to the direct native shell targets
from the roadmap: root help/version/discovery, heavy subcommand help, and the
native-owned public read-only commands. The `launcher-native` lane is
informational and helps track the extra Node launcher overhead above the direct
Rust shell. The JS-owned `status --json --no-check` benchmark remains in the
report for visibility, but it is intentionally informational-only under the
current safety boundary.

The local `bench:gate` script compares the direct native shell against the
current checkout's JS fallback path. `bench:gate:release` is the pinned
release-ready variant and uses the roadmap baseline tag `v1.7.0`, matching the
release workflow exactly.

If you want to compare a different ref, pass `--base <ref>` such as `HEAD~1`,
`origin/main`, or a release tag.
