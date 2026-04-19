# CLAUDE.md

Developer guide for AI agents contributing to this codebase.

For CLI consumer/agent integration docs, see [AGENTS.md](AGENTS.md) and [skills/privacy-pools-cli/SKILL.md](skills/privacy-pools-cli/SKILL.md).
For test architecture and suite policy, see [docs/testing.md](docs/testing.md).

## Build & Run

```bash
npm ci                   # install dependencies from package-lock.json
npm run build            # clean + tsc → dist/
npm run dev -- <args>    # run from source via node + tsx
npm run start -- <args>  # run from built dist/ via node
npm run typecheck        # tsc --noEmit
```

## Test Commands

```bash
npm run test                   # unit + integration + fuzz + services (~2 min)
npm run test:smoke             # packaged-smoke integration (timeout 180s)
npm run test:fuzz              # fuzz suite (timeout 120s)
npm run test:conformance       # build + conformance core suite
npm run test:conformance:all   # build + all conformance suites
npm run test:coverage          # hybrid coverage guard (same thresholds as above, plus no uninstrumented executable src files)
npm run test:evals             # agent eval suite (timeout 120s)
npm run test:e2e:anvil         # full anvil e2e (requires local anvil)
npm run test:e2e:anvil:smoke   # anvil smoke subset
npm run test:flake             # randomized non-e2e pass + targeted reruns
npm run test:stress            # stress test (120 rounds)
npm run test:ci                # full CI pipeline
```

`npm run test` uses `scripts/run-test-suite.mjs`, which delegates to `scripts/run-bun-tests.mjs` for the main batch plus the isolated suites listed in `scripts/test-suite-manifest.mjs`. Bun remains internal test tooling only; the CLI runtime itself is Node-only. For targeted Bun-runner coverage, invoke `node scripts/run-bun-tests.mjs <files...>`. Default per-test timeout is 30s unless you pass an explicit Bun timeout flag. The harness injects `PP_TEST_RUN_ID` per run and scopes temp dirs with `pp-` prefix for automatic cleanup.

`bunfig.toml` provides Bun-native test defaults such as `coverageSkipTestFiles`, but the repository still treats `scripts/check-coverage.mjs` as the authoritative coverage gate because Bun coverage alone does not count unloaded executable source files.

Process isolation is intentional here. Bun runs test files in a shared process by default, and `mock.module()` is not safely reversible in-process. If a suite remains listed as isolated in `scripts/test-suite-manifest.mjs`, treat that as a documented containment boundary, not a smell to “fix” with more `mock.restore()` calls.

The preferred test harness primitives are:
- `test/helpers/test-world.ts` for temp home/env/process lifecycle
- `test/helpers/contract-assertions.ts` for JSON envelope, nextActions, and stream-boundary checks
- `test/helpers/strict-stubs.ts` for fail-closed outbound expectations

Default isolated suites are intentionally limited to `contracts-service`, `proofs-service`, `workflow-mocked`, `workflow-internal`, and `init-interactive`. Coverage-only isolation additionally keeps `workflow-service` and `bootstrap-runtime` out of the shared batch.

To run a single test file: `node scripts/run-bun-tests.mjs ./test/unit/some-file.unit.test.ts`

## Architecture

```
src/
├── index.ts              # Entry point: shebang, console guard, fast-path routing
├── cli-main.ts           # Full CLI bootstrap: Commander setup, output mode wiring
├── program.ts            # Root Command with lazy-loaded subcommands
├── static-discovery.ts   # Fast-path static discovery (capabilities/describe)
├── command-shells/       # Commander command definitions (flags, args, help text)
├── commands/             # Command logic (business logic, orchestration)
├── output/               # Output renderers (JSON + human-readable per command)
├── services/             # SDK/chain/ASP/relayer/wallet/proof interaction
├── config/               # Chain configs, deployment hints, known pools
├── utils/                # Shared utilities (errors, formatting, validation, etc.)
└── types.ts              # Shared type definitions
```

### Key Patterns

**Three-layer command structure**: Each CLI command is split across three files:
1. `command-shells/<cmd>.ts` — Commander definition (flags, args, help text, examples)
2. `commands/<cmd>.ts` — Business logic and orchestration
3. `output/<cmd>.ts` — Output rendering (JSON on stdout, human on stderr)

**Lazy loading**: Root commands are lazy-loaded in `program.ts` via dynamic `import()` to minimize startup time. The entry point `index.ts` does fast-path routing for `--version`, `--help`, and `completion` before loading the full CLI.

**Dual output model**: Structured JSON always goes to stdout. Human-readable text goes to stderr. In `--agent` mode (equivalent to `--json --yes --quiet`), stderr is suppressed. The `--format csv` mode writes CSV to stdout.

**Console guard**: `installConsoleGuard()` permanently suppresses all `console.*` methods at startup to prevent SDK debug output (e.g. `[Data::WARN]`) from leaking into CLI output. The CLI uses `process.stdout.write` and `process.stderr.write` directly.

**Process locking**: `acquireProcessLock()` uses `O_EXCL` atomic file creation with PID-based stale detection. `guardCriticalSection()` defers SIGINT/SIGTERM during account state persistence.

**SDK type bridging**: The SDK uses branded types (`Hash`, `PoolInfo`). The CLI bridges these with `as unknown as` casts where the runtime representation is identical (e.g., `bigint` for `Hash`).

## Auto-Generated Files

- `docs/reference.md` — Generated by `scripts/generate-reference.mjs` from runtime command metadata. **Do not edit by hand.** Run `npm run docs:generate` to update, `npm run docs:check` to verify no drift.
- `src/utils/command-discovery-static.ts` — Generated by `scripts/generate-command-discovery-static.mjs`. Run `npm run discovery:generate` to update.

## SDK

The CLI depends on `@0xbow/privacy-pools-core-sdk@1.2.0`. Key classes:
- `DataService` — Chain data fetching and event indexing
- `AccountService` — Pool account management, deposit/withdrawal secret generation
- `generateMerkleProof`, `calculateContext`, `generateMasterKeys` — Standalone functions

## Supported Chains

Defined in `src/config/chains.ts`: mainnet (1), arbitrum (42161), optimism (10), sepolia (11155111), op-sepolia (11155420). The alias `ethereum` resolves to `mainnet`.

## Conventions

- ESM-only (`"type": "module"` in package.json). All imports use `.js` extensions.
- TypeScript strict mode. Build target: ESNext, module: Node16.
- Node ≥22 <26 required. Dev/CI baseline: Node 25.
- Test files follow `<name>.<category>.test.ts` naming (e.g., `withdrawal.unit.test.ts`).
- Error handling: throw `CLIError` with category, code, hint, and retryable fields.
- When adding a new public agent-facing error code or enum value, update the agent docs parity surface (`src/utils/error-code-registry.ts`, AGENTS/skill docs as needed) and rerun `npm run test:conformance`.
- Version references: CLI v2.0.0, SDK v1.2.0, JSON schema v2.0.0.

## Native/JS Duplication Inventory

The native Rust shell reimplements certain JS-side logic for performance.
These areas must be kept in sync when either side changes.

| Area | Rust file(s) | JS file(s) |
|------|-------------|------------|
| Config loading | `native/shell/src/config.rs` | `src/services/config.ts`, `src/config/chains.ts` |
| Root argv parsing | `native/shell/src/root_argv.rs` | `src/utils/root-argv.ts` |
| Output formatting | `native/shell/src/output.rs` | `src/output/layout.ts`, `src/utils/format.ts` |
| RPC ABI encoding | `native/shell/src/commands/pools/rpc_abi.rs` | viem library |
| Token metadata | `native/shell/src/commands/pools/rpc_token.rs` | viem `readContract` |
| NextActions | `native/shell/src/output.rs` | `src/output/common.ts` |

The bridge version guard (`src/runtime/runtime-contract.js` ↔ `native/shell/src/contract.rs`)
ensures the native binary is compatible with the JS runtime at the protocol level, but cannot
detect semantic drift within a version. When modifying any duplicated area, update both sides
and verify with `npm run test:conformance:all`.
