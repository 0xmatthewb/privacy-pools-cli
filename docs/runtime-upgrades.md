# Runtime Upgrade Playbook

This playbook is for maintainers working from a source checkout. The repository
script paths below are repo-only tooling, not installed-package commands.

Use this checklist whenever the CLI needs a new `runtime/vN` or a new JS/native
bridge for a future Privacy Pools protocol generation.

## Update The Runtime Contract First

Start in [`src/runtime/runtime-contract.js`](../src/runtime/runtime-contract.js).

- bump `CURRENT_RUNTIME_VERSION` when the active worker generation changes
- bump `CURRENT_WORKER_PROTOCOL_VERSION` when the worker request envelope changes
- bump `CURRENT_MANIFEST_VERSION` when the generated native manifest schema changes
- bump `CURRENT_NATIVE_BRIDGE_VERSION` when the launcher/native-shell bootstrap
  changes incompatibly

All other files should consume these values rather than introducing new
version literals.

## Add The New Runtime Boundary

- create `src/runtime/vN/`
- implement the new request/worker entrypoint there
- switch [`src/runtime/current.ts`](../src/runtime/current.ts) to the new runtime
- keep proof, signer, mnemonic, account-state, workflow, migration, and
  transaction-composition logic in JS unless there is an explicit security
  decision to move it

## Regenerate Runtime-Owned Metadata

- run `npm run discovery:generate`
- confirm [`src/utils/command-manifest.ts`](../src/utils/command-manifest.ts)
  plus [`native/shell/generated/manifest.json`](../native/shell/generated/manifest.json)
  and [`native/shell/generated/runtime-contract.json`](../native/shell/generated/runtime-contract.json)
  reflect the new manifest/runtime versions
- confirm route ownership and native modes still match the intended safety boundary

## Keep Packaging And Release Metadata In Sync

- update any new native package metadata through
  [`scripts/prepare-native-package.mjs`](../scripts/prepare-native-package.mjs)
- do not add root optional native dependencies until every referenced package is
  published for the release version; `npm ci` must not depend on unpublished
  host packages
- keep package naming human-facing (`macos`, `windows`, `linux`) even though npm
  `os` selectors must still use Node platform ids like `darwin` and `win32`
- keep release triplets aligned across:
  - [`.github/workflows/release.yml`](../.github/workflows/release.yml)
  - [`.github/workflows/cross-platform.yml`](../.github/workflows/cross-platform.yml)

## Run The Required Safety Checks

- prefer `npm run test:install` for the shared install/distribution gate; it
  builds once, packs once, and fans those prepared artifacts out to the
  packaged and installed-artifact verifiers
- `npm run build`
- `npm run discovery:generate`
- `npm run test:install`
- `npm run test:runtime:boundary`
- `npm run docs:check`
- `npm run test:release`

Use the standalone `npm run test:artifacts:host` and
`npm run test:smoke:native:package` lanes only for targeted debugging after the
shared install profile has already narrowed the failing boundary.

Also run a manual JS fallback drill:

- force JS with `PRIVACY_POOLS_CLI_DISABLE_NATIVE=1`
- run the packaged CLI and verify critical JS-owned commands still behave identically

## Published Install Troubleshooting

When a supported published npm install unexpectedly stays on the JS runtime,
check the install path before changing launcher logic:

- confirm the installed release includes the matching host native package or
  configure `PRIVACY_POOLS_CLI_BINARY` for local native-runtime testing
- unsupported hosts, including Linux musl/Alpine, intentionally stay on JS
- `status --agent` now surfaces `native_acceleration_unavailable` when a
  supported published install is missing or cannot validate its native runtime

## Release Checklist

- release tag must match `package.json` exactly (`vX.Y.Z`)
- local release rehearsal should pass `npm run bench:gate:release`
- packed native tarballs must pass
  [`scripts/verify-packed-native-package.mjs`](../scripts/verify-packed-native-package.mjs)
- do not make native own new wallet-sensitive commands without adding or updating
  safety-boundary conformance tests first
