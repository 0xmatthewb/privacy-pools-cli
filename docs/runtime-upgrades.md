# Runtime Upgrade Playbook

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
- verify [`package.json`](../package.json) optional native dependencies match the
  root package version
- keep release triplets aligned across:
  - [`package.json`](../package.json)
  - [`.github/workflows/release.yml`](../.github/workflows/release.yml)
  - [`.github/workflows/cross-platform.yml`](../.github/workflows/cross-platform.yml)

## Run The Required Safety Checks

- `npm run build`
- `npm run discovery:generate`
- `node scripts/run-bun-tests.mjs ./test/unit/launcher-routing.unit.test.ts ./test/unit/worker-request.unit.test.ts ./test/unit/bootstrap-runtime.unit.test.ts ./test/unit/runtime-current.unit.test.ts ./test/unit/root-argv.unit.test.ts ./test/conformance/native-manifest.conformance.test.ts ./test/conformance/command-discovery-static.conformance.test.ts --timeout 240000`
- `npm run test:smoke:native`
- `npm run docs:check`
- `npm run test:release`

Also run a manual JS fallback drill:

- force JS with `PRIVACY_POOLS_CLI_DISABLE_NATIVE=1`
- run the packaged CLI and verify critical JS-owned commands still behave identically

## Release Checklist

- release tag must match `package.json` exactly (`vX.Y.Z`)
- packed native tarballs must pass
  [`scripts/verify-packed-native-package.mjs`](../scripts/verify-packed-native-package.mjs)
- do not make native own new wallet-sensitive commands without adding or updating
  safety-boundary conformance tests first
