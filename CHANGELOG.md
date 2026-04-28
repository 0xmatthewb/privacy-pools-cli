# Changelog

All notable user-facing changes to this project are documented in this file.

The format is inspired by Keep a Changelog and follows semantic versioning.

## [2.0.0] - 2026-04-28

### Added

- Native Rust shell for verified read-only and discovery paths, including `guide`, `capabilities`, `describe`, public pool/activity/stats views, and fixture-backed parity coverage against the JS runtime.
- Versioned native bridge contract with `runtimeVersion`, `workerProtocolVersion`, `manifestVersion`, and `nativeBridgeVersion` checks before the launcher forwards work to the native shell.
- Machine JSON schema `2.0.0` with structured `error.{code,message,hint,docUrl,retryable}` payloads while preserving `errorCode` and `errorMessage` compatibility aliases.
- Canonical `nextActions.when` discriminator values so agents can route follow-up work without parsing prose.
- Generated command discovery artifacts for root help, command metadata, native routing, envelope schemas, error references, and agent-facing capability manifests.
- Runtime-contract docs and guardrails for native fallback, JS-owned sensitive flows, package verification, and native shell release validation.
- Deposit success JSON now includes `approvalTxHash` so agents can correlate the ERC-20 approval transaction with the deposit transaction and recover cleanly when an approval succeeds but a later deposit fails.

### Changed

- `--agent` remains the primary machine mode and now consistently implies quiet structured JSON across the expanded v2 envelope contract.
- Native acceleration is optional and fail-closed: signing, wallet initialization, account persistence, and all fund-moving protocol logic stay JS-owned.
- Native binary launches require checksum and bridge-metadata verification before use; invalid or incompatible native runtimes fall back to the JS path.
- Published root installs no longer declare unpublished host-native packages as optional dependencies, keeping `npm ci` and global installs deterministic until those packages are available on the registry.

### Removed

- `explain` command. Use `describe <schema-path>` or `describe envelope.<path>` instead.

### Migration

- Agents upgrading from 1.5.x or 1.7.x should parse `schemaVersion: "2.0.0"` and prefer `error.code` plus `nextActions[].when`; keep `errorCode` and `errorMessage` only as compatibility aliases.
- Operators who intentionally test a local native shell can set `PRIVACY_POOLS_CLI_BINARY` or use release artifacts that include a matching native package. The pure JS path remains fully supported when native acceleration is unavailable.
- Do not use `npm install --omit=optional` as a native-runtime control knob for 2.0.0; use `PRIVACY_POOLS_CLI_DISABLE_NATIVE=1` to force the JS path.

## [1.7.0] - 2026-03-26

### Added

- **`flow` command**: Easy-path deposit-to-withdrawal workflow. `flow start` deposits into a pool and saves a local workflow; `flow watch` polls for ASP approval and privately withdraws the full balance to the saved recipient when ready. `flow status` inspects the saved workflow and `flow ragequit` provides public recovery for declined workflows.
- **`--new-wallet` flag** (flow start only): Generates a dedicated per-workflow wallet, requires a backup before continuing, and waits for funding automatically. ETH flows wait for the full ETH target; ERC20 flows wait for both the token amount and a native ETH gas reserve.
- **`migrate status` command**: Read-only check of legacy pre-upgrade account migration or recovery readiness on CLI-supported chains.

### Changed

- Onboarding and reference docs now surface `flow` as the recommended easy path and document `--new-wallet` and `migrate status` alongside the existing manual command surfaces.
- Saved workflow handling is more robust across interrupts, local state persistence, and dedicated workflow wallet backups.

### Verification

- `npm test`
- `npm run test:coverage`
- `npm run test:e2e:anvil`
- `npm run docs:check`
- `npm run test:conformance`

## [1.6.1] - 2026-03-24

### Changed

- Aligned the CLI with `@0xbow/privacy-pools-core-sdk` `1.2.0` recovery behavior so imported recovery phrases rebuild legacy saved accounts and keep older Pool Accounts discoverable.
- Tightened startup, root help, and runtime discovery paths so `--help`, `capabilities`, `describe`, and machine-mode output stay lightweight while reflecting the live CLI contract accurately.
- Hardened release validation so packaged installs, built entrypoints, docs generation, stress coverage, and forked-chain flows run against isolated snapshots and packed artifacts instead of the live checkout.

### Fixed

- Fixed versionless cached account snapshots and sync flows so legacy local state is rebuilt from onchain events instead of silently degrading.
- Fixed relayed withdraw quote refresh handling, direct-withdraw and ragequit JSON contract drift, and chain-specific history time estimates on faster L2s.
- Fixed root help flag visibility, packaged-smoke/build race conditions, docs-generation drift, and test harness isolation across temp homes, env boundaries, and packed builds.

### Verification

- `npm run test:all`
- `npm run test:e2e:anvil`
- `npm run docs:check`
- `npm pack --dry-run`

## [1.6.0] - 2026-03-20

### Added

- Added built-entrypoint and packed-tarball coverage so shipped installs are verified directly before release.
- Added dedicated packaged-smoke, coverage, Anvil smoke, evals, and core-conformance lanes while keeping frontend parity informational.

### Changed

- Reworked startup and discovery paths so `--version`, `--help`, `guide`, `capabilities`, and `describe` stay on lightweight fast paths while heavier command runtime code loads only when needed.
- Tightened completion query handling, root discovery output, and update-check timing so read-only and agent-facing commands feel much faster without changing the CLI contract.
- Adopted Node 25 as the development and CI baseline while supporting the published CLI on Node 22.x, 24.x, and 25.x.
- Refreshed runtime and tooling dependencies, docs generation, and packaged validation so the shipped build, docs, and merge gate stay aligned.

### Fixed

- Fixed bare `--format=csv` invocation so it falls back to the normal human welcome flow instead of exiting silently.
- Fixed `status` and local account loading to degrade more gracefully when a cached account file is corrupt.
- Fixed conformance and smoke coverage to use pinned upstream fixtures, live-source parity checks, and the actual packed tarball rather than the repo checkout.

### Verification

- `npm run test:ci`
- `npm run docs:check`
- `npm run test:smoke`
- `npm pack --dry-run`

## [1.5.0] - 2026-03-13

### Added

- Surfaced the `completion` command in root help and added PowerShell completion generation alongside bash, zsh, and fish.
- Added generated `docs/reference.md` output from the runtime command tree and metadata, plus a docs drift check that keeps the shipped reference aligned with the CLI.
- Added an agent eval harness and end-to-end scenarios covering discovery, `nextActions`, and retry/error behavior.

### Changed

- Reworked root help and `privacy-pools guide` so onboarding, command discovery, and shell-completion setup are easier to follow for new users.
- Enriched command metadata, `capabilities`, `describe`, `AGENTS.md`, and skill docs so human and agent discovery stay aligned on positional syntax, `--agent`, and runtime workflow guidance.
- Improved dynamic completion suggestions by deriving choice values for `--format`, `pools --sort`, and `--unsigned` flows from runtime command definitions where possible.
- Hardened the default quality gates so CI now covers evals, generated docs drift, and clean-checkout conformance behavior.

### Fixed

- Fixed agent follow-up execution so structured `nextActions.options` convert correctly from camelCase metadata to CLI kebab-case flags, including `false` boolean options.
- Fixed ambiguous agent-facing usage strings for deposit, withdraw, withdraw quote, and ragequit so runtime discovery no longer advertises invalid hybrid invocations.
- Fixed the human guide’s completion hint so it points users to setup instructions instead of dumping a raw shell script.

### Verification

- `npm run typecheck`
- `npm run test:ci`
- `npm run docs:check`
- `npm run test:smoke`

## [1.4.0] - 2026-03-13

### Breaking

- Bumped the machine-readable JSON schema to `1.5.0`.
- Pool Account `status` now reports effective review and lifecycle states instead of generic `spendable`, with active accounts surfacing `approved`, `pending`, `poi_required`, `declined`, or `unknown`.
- `accounts --summary` replaced `spendableCount` with `poiRequiredCount`, `declinedCount`, and `unknownCount`.

### Added

- Shared status-color rendering for account and review states across CLI output.
- Explicit support for `declined`, `poi_required`, and fail-closed `unknown` ASP review states throughout machine and human flows.
- Public-activity normalization and richer pool-detail warnings so degraded wallet-state paths stay actionable without leaking low-level RPC noise.

### Changed

- `accounts`, `pools`, `activity`, `withdraw`, and `ragequit` now share a consistent ASP review-state model and action-eligibility rules.
- Agent discovery, runtime metadata, and shipped docs now standardize on `--agent` as the canonical automation mode.
- Bare invocation, welcome/banner behavior, and packaged `start` flow were tightened so source checkouts and installed builds fail more predictably.
- `package-lock.json` is refreshed to match the published package metadata and remove the retired `pp` alias from release artifacts.

### Fixed

- Blocked private withdraw for deposits that are `declined`, still pending ASP leaves, or require Proof of Association.
- Made `ragequit` state-aware so exit guidance matches the selected Pool Account’s real recovery path.
- Fixed stale agent and skill-reference copy drift around approval polling, stream boundaries, and discovery examples.
- Replaced vague built-artifact startup failures with a clear build hint when `dist/` is missing.

### Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:ci`
- `npm run test:smoke`

## [1.3.0] - 2026-03-13

### Added

- Unified next-step guidance for humans and agents through a shared `nextActions` renderer, with runtime discovery exposed via `capabilities` and `describe`.
- State-aware onboarding and recovery flows that distinguish first run, restore, signerless read-only setups, and wallets with existing deposits.
- A default multi-chain `accounts` dashboard across supported mainnet chains, with compact polling-oriented views for agents.

### Changed

- `accounts` now shows all Pool Accounts by default, including spent and exited history, and loads supported mainnet chains in parallel with delayed aggregate progress on slower runs.
- Deposit approval polling, restore routing, and withdrawal remediation now preserve chain scope consistently across human output, machine `nextActions`, and long-form docs.
- Help, reference docs, and agent skill docs are aligned around the `1.3.0` JSON contract and canonical next-step behavior.
- RPC and retry handling now reuse healthy probe results, share retry infrastructure, and prefer fallbacks that support `eth_getLogs`.

### Fixed

- Removed misleading or non-runnable next steps across `status`, `init`, `withdraw quote`, `accounts`, and post-deposit follow-ups.
- Fixed testnet and mixed-chain workflows that previously suggested bare `accounts` or incorrect chain flags.
- Started account sync from per-pool deployment blocks so late-deployed pools avoid unnecessary backfill work.
- Hardened relayer retries, network error classification, and deferred SDK stdout suppression.

### Verification

- `npm run typecheck`
- `npm run test:ci`
- `npm run test:e2e:anvil`

## [1.2.0] - 2026-03-10

### Breaking

- Removed `pp` binary alias. Use `privacy-pools` (power users can `alias pp=privacy-pools`).
- Replaced `--unsigned-format <format>` with `--unsigned [format]`. Legacy `--unsigned-format` now returns a targeted INPUT migration error explaining the new syntax.

### Added

- **Privacy guard:** Non-round deposit amounts now warn (interactive) or error (agent mode) by default. Pass `--ignore-unique-amount` to bypass. Stablecoins require whole numbers; volatile assets allow up to 2 decimal places.
- **Withdraw hints:** Non-round withdrawal amounts emit a non-blocking privacy tip on stderr suggesting nearby round alternatives.
- Docs now standardize on `privacy-pools` with long flags and amount-first positional syntax.

### Changed

- `--unsigned` now accepts an optional format argument: `--unsigned` (envelope, default) or `--unsigned tx` (raw transaction array).
- Command argument descriptions updated to reflect canonical `<amount> <asset>` ordering.
- Deposit, withdraw, and ragequit examples across all surfaces updated to use canonical forms.

### Migration

- `pp` → `privacy-pools` (or add `alias pp=privacy-pools` to your shell profile)
- `--unsigned --unsigned-format tx` → `--unsigned tx`
- `--unsigned --unsigned-format envelope` → `--unsigned` (envelope is the default)
- Agent integrations: non-round deposit amounts now require `--ignore-unique-amount` flag

## [1.1.0] - 2026-03-10

### Changed

- Hardened CLI UX for both humans and agents across setup, discovery, deposit, accounts, withdraw, ragequit, and completion flows.
- Centralized command metadata so help, capabilities, and agent-facing docs stay aligned.
- Cleaned up the machine-readable `1.1.0` JSON contract around workflow guidance, recovery phrase naming, timestamps, and pool asset fields.

### Fixed

- Cleaned `dist` before build and package steps and blocked stale compiled artifacts from shipping.
- Fixed shell completion for `privacy-pools`.
- Tightened renderer, contract-doc, and drift coverage to catch output and packaging regressions earlier.

### Verification

- `npm run typecheck`
- `PP_NO_UPDATE_CHECK=1 npm run -s build`
- `PP_NO_UPDATE_CHECK=1 npm run test:ci`
- `PP_NO_UPDATE_CHECK=1 PP_ANVIL_E2E=1 npm run test:e2e:anvil`

## [1.0.2] - 2026-03-09

### Changed

- Aligned the CLI with `@0xbow/privacy-pools-core-sdk` `1.1.1` and the upstream PR 118 / PR 121 behavior changes.
- Hardened localhost and Anvil sync behavior with a local compatibility data service.
- Kept circuit provisioning and runtime checksum verification on a shared manifest without breaking the packaged Node CLI.

### Fixed

- Preserved zero-value withdrawals in history reconstruction and local RPC event sync.
- Restored packaged CLI compatibility for circuit checksum loading under Node ESM.
- Added regression coverage for the signed direct-withdraw recipient guard.

### Verification

- `npm run typecheck`
- `npm run test:ci`
- `npm run test:smoke`
- `PP_STRESS_ENABLED=1 npm run test:stress`
- `npm run test:e2e:anvil`

## [1.0.1] - 2026-03-07

### Changed

- Switched proof generation to local `snarkjs` and transaction submission to local `viem` writes.
- Provisioned circuit artifacts into a CLI-managed cache with checksum verification.
- Added forked Anvil end-to-end coverage for deposit, ragequit, direct withdraw, and relayed withdraw.

### Fixed

- Hardened pool resolution with known-pool fallback and stricter address validation.
- Fixed `--no-sync` behavior for `accounts` and `history`.

### Verification

- `npm run test`
- `npm run test:ci`
- `npm run test:smoke`
- `npm run test:e2e:anvil`

## [1.0.0] - 2026-03-05

### Added

- First stable release of the Privacy Pools CLI.
- GitHub Actions CI/CD workflows for automated build, test, and release checks.
- Initial packaged release flow for the CLI.

### Verification

- Enabled GitHub Actions CI/CD workflows for the repository.
- Completed the initial packaging and release flow.

[1.7.0]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/0xmatthewb/privacy-pools-cli/releases/tag/v1.0.0
