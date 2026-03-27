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
- Anvil E2E
  - `bun run test:e2e:anvil:smoke` is the fast representative lane.
  - `bun run test:e2e:anvil` is the broader local-only matrix built on the shared self-contained fixture.

## Isolation Policy

The authoritative isolation map lives in [`scripts/test-suite-manifest.mjs`](../scripts/test-suite-manifest.mjs).

Rules:

- If a suite uses `mock.module()` on shared dependencies and Bun can leak those replacements across later imports, keep it isolated.
- Every isolated suite must include a concrete `reason`.
- `mock.restore()` and `mock.clearAllMocks()` clean up spies/functions only. They do not fully undo `mock.module()`.
- Do not try to "fix" a documented isolated suite by adding more restore calls unless the suite genuinely stops replacing shared modules.

Current default isolated suites:

- `contracts-service`
- `proofs-service`
- `workflow-mocked`
- `workflow-internal`
- `init-interactive`

Current coverage-only isolated suites:

- `workflow-service`
- `bootstrap-runtime`

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

Local targets on the current machine:

- `bun run test`: about 95 seconds or better
- `bun run test:coverage`: about 20 seconds or better
- `bun run test:e2e:anvil:smoke`: about 30 seconds or better
- `bun run test:e2e:anvil`: about 150 seconds or better

If a target is missed:

- prefer acceptance migration, exact-file CI sharding, and affected-path selection
- do not weaken assertions or lower coverage thresholds to get speed back

CI notes:

- `scripts/ci/test-shards.mjs` uses `scripts/ci/test-shard-weights.json` for deterministic runtime-aware shard balancing.
- `.github/workflows/flake.yml` is the non-blocking Bun-native flake lane (`--randomize` plus targeted `--rerun-each`).

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
- `npm run test:smoke:native`
- packed native tarball verification
- every shipped native triplet
- supported Node versions on the blocking native-smoke lane
