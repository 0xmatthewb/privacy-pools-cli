# Test Suite Architecture

This repository uses a Bun-aligned test architecture. The important constraint is that `bun test` runs files in a shared process by default, and Bun's `mock.module()` replacements are not safely reversible in-process. Our suite therefore treats subprocess isolation as a deliberate containment boundary, not as an anti-pattern by itself.

## Suite Types

- `test/unit/`
  - Source-level coverage for command handlers, output renderers, parsing, and small orchestration helpers.
  - Prefer direct imports and semantic assertions over snapshots.
- `test/services/`
  - Source-level coverage for SDK, ASP, relayer, workflow, circuit, and persistence services.
  - Use strict outbound stub registries around RPC, ASP, relayer, and child-process boundaries and fail closed on unexpected or unused calls.
- `test/acceptance/`
  - Typed CLI journey tests built on `test/acceptance/framework.ts` and `test/helpers/test-world.ts`.
  - These are the primary home for broad subprocess-driven command contracts such as help/version/welcome flows, stream separation, JSON envelopes, fail-closed UX, and filesystem side effects.
- `test/integration/`
  - Hand-written subprocess suites that still cover built/package/runtime boundaries, cross-platform concerns, environment trust boundaries, and offline pipeline boundaries that acceptance should not own.
  - Once an integration suite has a contract-equivalent acceptance replacement, exclude the legacy integration file from the default lane via `scripts/test-suite-manifest.mjs`.
- `test/fuzz/`
  - Cheap machine-safety invariants for parsing, error normalization, output contracts, and proof serialization helpers.
- `test/evals/`
  - Agent-focused behavior checks such as `nextActions` quality.
- `test/conformance/`
  - Source-of-truth, docs, discovery, and generated-artifact alignment.
  - Also owns fast syntax/integrity checks for Node-side release/install helper scripts under `scripts/**/*.mjs`.
- Anvil E2E
  - `npm run test:e2e:anvil:smoke` is the fast representative lane.
  - `npm run test:e2e:anvil` is the broader local-only matrix built on the shared self-contained fixture.

## Placement Decision Tree

When adding or moving a test, use this order:

1. Can the behavior be verified with direct imports, strict mocks, or local fixtures?
   - Put it in `test/unit/` or `test/services/`.
   - This is the default home for error paths, branch coverage, fallback logic, retry classification, stale-state handling, and fail-closed behavior.
2. Is the behavior a canonical CLI contract that needs a subprocess, but not a special runtime/package/native boundary?
   - Put one representative journey in `test/acceptance/`.
   - Acceptance owns JSON envelopes, stream ownership, filesystem side effects, welcome/help/version flows, and broad CLI behavior.
3. Is the behavior specifically about packaging, runtime selection, native/launcher ownership, offline trust boundaries, or built/install artifacts?
   - Put it in `test/integration/`.
   - Integration is not the default home for extra branch coverage.
4. Does the behavior need a real Anvil-backed environment or truly fund-moving/stateful truth?
   - Put the smallest representative case in the Anvil lane.
   - Do not use Anvil to cover ordinary branching that can be proven in-process.
5. Is the behavior about generated docs, selectors, ABI/event shapes, runtime descriptors, or packaged machine contracts?
   - Put it in `test/conformance/`.

If more than one lane could work, choose the cheapest lane that still proves the contract.

## Isolation Policy

The authoritative isolation map lives in [`scripts/test-suite-manifest.mjs`](../scripts/test-suite-manifest.mjs).

Rules:

- If a suite uses `mock.module()` on shared dependencies and Bun can leak those replacements across later imports, keep it isolated.
- Every isolated suite must include a concrete `reason`.
- `mock.restore()` and `mock.clearAllMocks()` clean up spies/functions only. They do not fully undo `mock.module()`.
- Do not try to "fix" a documented isolated suite by adding more restore calls unless the suite genuinely stops replacing shared modules.

Coverage also runs the remaining shared source suites in deterministic fixed-size batches via
[`scripts/coverage-suite-plan.mjs`](../scripts/coverage-suite-plan.mjs). If Bun finishes a batch
without writing `lcov.info`, the coverage guard retries that exact batch before splitting it into
smaller batches, so missing coverage artifacts fail closed without turning one flaky suite into a
global coverage failure.

When to use preload:

- Only when a suite must install a mock before the first import side effect.
- Do not add a global preload.

## Assertion Style

Prefer assertions that protect user-facing or agent-facing contracts:

- exact exit status
- stdout/stderr separation
- JSON envelope structure and key fields
- `errorCode`, `category`, `retryable`, and `hint`
- `nextActions` shape and runnable semantics
- filesystem/home side effects
- fail-closed behavior on partial state or partial network failure
- unsigned transaction payloads (`to`, `data`, `value`, `chainId`, ordering, descriptions)

Shared helpers live in:

- `test/helpers/contract-assertions.ts`
- `test/helpers/unsigned-assertions.ts`
- `test/helpers/strict-stubs.ts`
- `test/helpers/test-world.ts`

Avoid low-value tests that mostly pin implementation trivia:

- broad snapshots when a few semantic assertions would do
- exact export inventories with little safety value
- tests that only assert "command exits 0" without checking the contract
- exact human copy when the real contract is a section, warning, next action, or stream boundary
- source-tree inventory equality inside smoke lanes

For CLI transcript coverage, prefer semantic checks over copy pinning:

- section markers and headings
- warning/sentinel presence
- stdout/stderr ownership
- JSON/CSV shape
- filesystem or saved-workflow effects

Keep exact transcript equality only where the contract is intentionally rigid,
such as machine-readable JSON envelopes, completion output, or fail-closed
native error envelopes.

## Suite Contract

The suite contract is intentionally opinionated:

- no real network in unit tests
- one canonical happy-path integration lane per command by default
- extra end-to-end coverage only for fund-moving or heavily stateful flows
- live-chain, native, and install lanes are boundary checks, not branch-coverage vehicles
- protocol truth stays pinned and versioned: selectors, ABI/event shapes, SDK compatibility, circuit/runtime descriptors

Expensive lanes are tagged in [`scripts/test-suite-manifest.mjs`](../scripts/test-suite-manifest.mjs)
with metadata such as `tags`, `fixtureClass`, and optional `budgetMs`. Use
runner filters such as `--tag native`, `--exclude-tag expensive`, or
`PP_TEST_ISOLATED_CONCURRENCY=<n>` when you need to target or debug a specific
cost class locally.

Stable tag taxonomy:

- suite families: `unit`, `services`, `acceptance`, `integration`, `conformance`
- environment/boundary: `native`, `install-boundary`, `anvil`, `protocol`
- risk and cost: `workflow`, `fund-moving`, `expensive`, `quarantined`

Every isolated, on-demand, quarantined, or otherwise high-cost suite must declare:

- `tags`
- `fixtureClass`
- `budgetMs`

## Flake And Quarantine Policy

- Blocking profiles must not silently retry whole suites more than once.
- Informational flake jobs may rerun targeted suites to gather signal, but they are not allowed to redefine the blocking contract.
- Temporarily quarantined suites must move into the manifest's `quarantined` lane with an explicit reason and owner note in the test body or adjacent comment.
- Quarantined suites stay out of blocking profiles and only run through informational flake paths until they are fixed and removed from quarantine.
- Do not leave a flaky test half-disabled inside the blocking lane. Quarantine it explicitly or fix it before merge.

## Shared Harness Pattern

For new expensive or stateful suites, prefer the shared patterns that already exist:

- one suite-scope bootstrap helper per expensive environment
- one canonical temp-home/temp-dir helper with `pp-` prefixes
- one strict outbound stub registry that fails on unexpected calls
- one semantic CLI assertion helper set for JSON, stderr/stdout ownership, and section markers

Avoid one-off local harnesses unless the existing helpers cannot model the behavior safely.

## Maintainer Review Checklist

Before merging a new or heavily changed test, confirm:

- the suite is the cheapest lane that can prove the contract
- the test asserts behavior, not incidental wording or file inventory
- unit/service tests do not use the real network
- new isolated or expensive suites declare `tags`, `fixtureClass`, `budgetMs`, and an isolation reason when needed
- end-to-end coverage is representative rather than exhaustive
- fund-moving and protocol-sensitive changes add coverage closest to the risky logic, not just another smoke case

## Cleanup Rules

Every test that mutates process or filesystem state must clean up:

- restore env changes after each test
- restore spy/function mocks after each test
- clean temp homes and temp dirs
- shut down child processes and fixture servers
- prefer helper-managed temp homes with the `pp-` prefix

If a suite still needs process isolation after local cleanup is in place, keep it isolated and document why.

## Coverage Policy

The authoritative coverage gate is [`scripts/check-coverage.mjs`](../scripts/check-coverage.mjs), not Bun's built-in threshold support.

Why:

- Bun coverage only measures files that are actually loaded.
- Child-process CLI acceptance/integration suites are behavioral contracts, not authoritative source line coverage.
- This repo also counts uninstrumented executable `src/**` files against the gate.

Current policy:

- overall executable `src/`: `>= 85%`
- `src/services/`: `>= 85%`
- `src/services/workflow.ts`: `>= 85%`
- `src/commands/`: `>= 85%`
- `src/utils/`: `>= 85%`
- `src/output/`: `>= 85%`
- `src/command-shells/`: `>= 85%`
- bootstrap/runtime wiring: `>= 85%`
- `src/config/`: `>= 95%`

`bunfig.toml` only provides Bun-native defaults such as `coverageSkipTestFiles`. It does not replace the repository coverage guard.

## Performance Targets

Local targets vary by hardware and by whether the run includes built-workspace,
package, and behavior-signal subprocess lanes. Treat these as order-of-magnitude
budgets rather than strict SLAs:

- `npm test`: low minutes and bounded, with no hangs
- `npm run test:coverage`: a few minutes, dominated by in-process unit/service/conformance batches plus isolated coverage lanes
- `npm run test:e2e:anvil:smoke`: about a minute or better
- `npm run test:e2e:anvil`: a few minutes or better

For CLI startup work, prefer command-family budgets over one global benchmark:

- `static/local`: root help, version, generated discovery, completion query
- `native public read-only`: `pools`, `activity`, `protocol-stats`, `pool-stats`
- `js read-only/config`: `status --json --no-check`, upgrade/config inspection
- `transactional/proof-heavy`: deposit/withdraw/ragequit/flow, where network and proving costs dominate

The benchmark harness in [`docs/performance.md`](./performance.md) prints those
families explicitly so launcher/native work is judged against the right budget.
Do not trade away UX or correctness in the transaction-heavy family to chase
micro-optimizations that only matter on static or read-only routes.

If a target is missed:

- prefer acceptance migration, exact-file CI sharding, and affected-path selection
- do not weaken assertions or lower coverage thresholds to get speed back

CI notes:

- `scripts/ci/test-shards.mjs` uses `scripts/ci/test-shard-weights.json` for deterministic runtime-aware shard balancing.
- `npm run test:timings:refresh -- --report <report.json> [--report <report.json> ...]` updates the committed timing baselines in `scripts/test-runtime-metadata.json` from emitted runtime reports.
- `npm run test:shards:refresh -- --report <report.json> [--report <report.json> ...]` refreshes `scripts/ci/test-shard-weights.json` from those same runtime reports after major suite reshapes.
- `npm run test:scripts` runs `node --check` across `scripts/**/*.mjs` and is included in the conformance path so broken release/install helpers fail in blocking CI before release day.
- `npm run test:install` is the shared install/distribution contract: build once, pack the CLI tarball once, then fan out packaged JS smoke, root-only installed-artifact verification, and current-host native packaging/install verification from those prepared artifacts. The installed-artifact legs run only on supported Node runtimes (`>=22 <26`); unsupported local hosts skip them with an explicit message instead of failing opaquely.
- `npm run test:native:fmt` and `npm run test:native:lint` are the fast Rust-native formatting and clippy gates for `native/shell`.
- `npm run test:native` runs the Rust-native suite directly against `native/shell`, including binary integration tests for the compiled native shell.
- `npm run test:coverage:native` is the Rust line-coverage guard for the native shell. It requires `cargo-llvm-cov`; CI installs it with `taiki-e/install-action`.
- The native gate now enforces `>= 85%` coverage for these non-overlapping ownership families:
  - root/global argv parsing (`root_argv`)
  - native completion parsing/rendering (`completion`)
  - read-only routing/mode resolution (`routing`)
  - native host/dispatch (`bridge`, `dispatch`, `main`)
  - native core utilities (`config`, `contract`, `error`, `http_client`, `json`, `output`, `read_only_api`)
  - native activity command ownership (`commands/activity/**`)
  - native stats command ownership (`commands/stats.rs`)
- The native coverage gate now also fails closed if any executable `native/shell/src/**` file is not owned by exactly one native coverage family. Test-only support such as `native/shell/src/test_env.rs` is excluded from that ownership check.
- `commands/pools/**` is now also enforced at `>= 85%`, so a green local profile means every executable native-shell ownership family is under a blocking native coverage floor, not just the root/host/core/activity/stats subset.
- `scripts/run-test-profile.mjs` is the shared source of truth for the higher-level repo test profiles (`test:install`, `test:conformance`, `test:ci`, `test:release`, `test:all`) so gate ordering only has to change in one place.
- `npm test` stays fast and host-neutral: it excludes packed smoke, packaged native smoke, the split native boundary lanes, and shared-Anvil suites. Those lanes still run in explicit higher-cost profiles.
- `npm run test:release` and `npm run test:all` no longer rerun the source shared-Anvil smoke trio after `test:e2e:anvil`; they reuse the full shared-Anvil coverage and then run the installed-artifact verification directly so the highest-cost profiles stay meaningful without duplicating the same source E2E coverage.
- Public GitHub plus npm are the conformance sources of truth. Use `CONFORMANCE_UPSTREAM_REF=<sha>` only when you intentionally want to audit against a specific public upstream revision instead of `main`.
- `npm run test:conformance` is the faster core public-source conformance lane. `npm run test:conformance:all` adds the slower frontend-parity shard on top.
- `npm run test:ci` stays on the faster core conformance lane. `npm run test:release` upgrades to the live/frontend-parity conformance superset before the release benchmark gate.
- The top-level local profiles share prepared build snapshots and install artifacts, so run `npm run test:ci`, `npm run test:release`, and `npm run test:all` serially on one checkout rather than in parallel.
- `.github/workflows/flake.yml` is the non-blocking Bun-native flake lane (`--randomize` plus targeted `--rerun-each`).
- `.github/workflows/flake-anvil.yml` is the separate heavier flake lane for shared-Anvil smoke reruns. It is informational and changed-path selected on pull requests so the fast flake job stays lightweight.
- `.github/workflows/native-coverage.yml` remains the dedicated Rust-native coverage lane for detailed reporting, and the shared `test:ci` / `test:release` profiles now also run `npm run test:coverage:native` so local and blocking verification fail on native coverage regressions too.
- `npm run test:ci` now includes both the root-only and current-host packed-artifact install checks so local verification exercises the installed JS launcher path everywhere and, on supported hosts, the same installed launcher/native path that blocking CI enforces.
- `npm run test:release` adds those same root-only and current-host artifact checks plus `npm run bench:gate:release`, matching the release workflow's pinned performance gate.
- `npm run test:packed-smoke` is the fast packed-tarball smoke lane. `npm run test:smoke` remains as a compatibility alias.
- `npm run test:install` is still the authoritative install-fidelity gate: it prepares artifacts once, then verifies packed smoke, root-only installed artifacts, and current-host install behavior from those prepared artifacts.
- `npm run test:smoke:native:shell` now runs the split native boundary trio: machine-contract parity, launcher/routing smoke, and semantic human-output smoke.
- `npm run test:smoke:native:package` is the packaged native smoke lane. `npm run test:artifacts:host` is the installed-artifact lane and now verifies both root-only and native-resolved installs. `npm run test:smoke:native` remains as a compatibility alias for the packaged native smoke lane.
- `npm run test:flake:anvil` reruns the representative Anvil smoke suite so stateful/native/install paths get nightly flake coverage without inflating the required CI lane.
- Shared-Anvil lanes use the repo-local fixture in `test/fixtures/anvil-contract-artifacts`, so standard Anvil commands no longer need a separate contracts checkout or extra contracts-specific environment setup.
- `npm run anvil:fixture:refresh -- --contracts-root <privacy-pools-core/contracts path>` is the maintainer-only refresh path when the committed fixture needs to be updated from upstream contract artifacts.
- Bun remains test-runner-only. Slow Bun-backed lanes now have both per-test timeouts and an outer process watchdog so wedged subprocesses fail boundedly instead of hanging indefinitely.
- Raw profile steps are bounded too: `scripts/test-profiles.mjs` now applies a shared outer watchdog to long `npm`/`node`/`cargo` legs so a wedged build or native step cannot hang `test:ci`, `test:release`, or `test:all` indefinitely.

## Runtime Upgrade Playbook

Future `runtime/vN` work should start from one source of truth:
[`src/runtime/runtime-contract.js`](../src/runtime/runtime-contract.js).

Keep these version concepts separate:

- worker request envelope
- generated native manifest schema
- launcher/native-shell bridge
- active runtime generation

Before shipping a new runtime generation, follow
[`docs/runtime-upgrades.md`](./runtime-upgrades.md) and make sure the
release/CI gates still exercise:

- JS fallback behavior
- `npm run test:smoke:native:package`
- packed native tarball verification
- every shipped native triplet
- supported Node versions on the blocking native-smoke lane
