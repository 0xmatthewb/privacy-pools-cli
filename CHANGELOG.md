# Changelog

All notable user-facing changes to this project are documented in this file.

The format is inspired by Keep a Changelog and follows semantic versioning.

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

[1.0.2]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/0xmatthewb/privacy-pools-cli/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/0xmatthewb/privacy-pools-cli/releases/tag/v1.0.0
