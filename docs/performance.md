# Performance Benchmarking

Use the local benchmark harness to compare the current checkout against a git ref:

```bash
node scripts/bench-cli.mjs
node scripts/bench-cli.mjs --base origin/main
node scripts/bench-cli.mjs --base origin/main --runs 12
node scripts/bench-cli.mjs --runtime native
node scripts/bench-cli.mjs --runtime launcher-binary-override
node scripts/bench-cli.mjs --runtime both --runs 6
node scripts/bench-cli.mjs --runtime all --runs 6
npm run bench:gate
npm run bench:gate:release
```

The harness builds both checkouts, runs a read-only command matrix, and prints
median timing deltas. Base timings always use the JS fallback path so native
preview branches can be compared directly against the current npm baseline.

Use `--runtime js` for the pure JS launcher path, `--runtime native` for the
direct Rust shell path, `--runtime launcher-binary-override` for the current
checkout's launcher path with local JS fast paths disabled and native handoff
forced on, `--runtime both` to print the JS and direct-native lanes together,
or `--runtime all` to print every lane in one report. The
`launcher-binary-override` lane keeps launcher overhead visible instead of
short-circuiting through local root fast paths. `launcher-native` remains
accepted as a backward-compatible alias.

The `js` lane still includes `status --json --no-check`, but that command is
intentionally JS-owned for the fund-safety boundary and is not part of the
enforced native shell gate.

The benchmark output also labels each row by command family so regressions stay
grounded in the right part of the CLI:

- `static/local`: root help, version, and generated discovery fast paths
- `heavy help`: JS-owned help surfaces that still exercise larger command trees
- `js read-only/config`: safe read-only JS paths such as `status --json --no-check`
- `native public read-only`: public read-only routes that should benefit most from the Rust shell

It keeps the setup intentionally lightweight:

- no extra dependencies
- no external benchmark runner
- isolated temp home for `status --json --no-check` in the JS lane
- local fixture-backed ASP/RPC paths for public read-only commands
- chain-scoped pool-stats fixtures plus matching RPC stubs for the default
  multi-mainnet `pools --agent` success path

The default command matrix covers:

- `--help`
- `--version`
- `capabilities --agent`
- `describe withdraw quote --agent`
- `flow --help`
- `migrate --help`
- `status --json --no-check`
- `pools --agent`
- `pools --agent --chain sepolia`
- `activity --agent`
- `activity --agent --chain sepolia --asset ETH`
- `stats --agent`
- `stats pool --agent --chain sepolia --asset ETH`

Treat those families as distinct budgets rather than one global number:

- `static/local` should stay extremely fast and avoid loading the heavy JS tree
- `heavy help` should remain bounded even though it still exercises JS-owned command shells
- `js read-only/config` should avoid duplicate bootstrap/setup work
- `native public read-only` is the main performance-sensitive native shell budget

The enforced `bench:gate` thresholds apply to the direct native shell targets
from the roadmap: root help/version/discovery, heavy subcommand help, and the
native-owned public read-only commands. The `launcher-binary-override` lane is
informational and helps track the extra Node launcher overhead above the direct
Rust shell. The JS-owned `status --json --no-check` benchmark remains in the
report for visibility, but it is intentionally informational-only under the
current safety boundary.

The local `bench:gate` script compares the direct native shell against the
current checkout's JS fallback path. `bench:gate:release` is the pinned
release-ready variant and uses the roadmap baseline tag `v2.0.0`, matching the
release workflow exactly.

If you want to compare a different ref, pass `--base <ref>` such as `HEAD~1`,
`origin/main`, or a release tag.

For local route diagnostics while profiling, set `PRIVACY_POOLS_DEBUG_RUNTIME=1`.
That opt-in mode writes route-planning, launcher completion timing, native
resolution cache events, ASP request latency, RPC read latency, and pool
resolution timing to stderr without changing normal CLI output by default.
