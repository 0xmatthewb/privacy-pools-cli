# Changelog

All notable user-facing changes to this project are documented in this file.

The format is inspired by Keep a Changelog and follows semantic versioning.

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

- `bun run typecheck`
- `bun run test:ci`
- `bun test ./test/integration/cli.packaged-smoke.integration.test.ts`
- `PP_STRESS_ENABLED=1 bun test ./test/fuzz/cli.stress-120-rounds.test.ts --timeout 240000`
- `PP_ANVIL_E2E=1 bun run test:e2e:anvil`

## [1.0.1] - 2026-03-07

### Changed

- Switched proof generation to local `snarkjs` and transaction submission to local `viem` writes.
- Provisioned circuit artifacts into a CLI-managed cache with checksum verification.
- Added forked Anvil end-to-end coverage for deposit, ragequit, direct withdraw, and relayed withdraw.

### Fixed

- Hardened pool resolution with known-pool fallback and stricter address validation.
- Fixed `--no-sync` behavior for `accounts` and `history`.

### Verification

- `bun run test`
- `bun run test:ci`
- `bun run test:smoke`
- `PP_ANVIL_E2E=1 bun run test:e2e:anvil`

## [1.0.0] - 2026-03-05

### Added

- First stable release of the Privacy Pools CLI.
- GitHub Actions CI/CD workflows for automated build, test, and release checks.
- Initial packaged release flow for the CLI.

### Verification

- Enabled GitHub Actions CI/CD workflows for the repository.
- Completed the initial packaging and release flow.

[1.1.0]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/0xmatthewb/privacy-pools-cli/releases/tag/v1.0.0
