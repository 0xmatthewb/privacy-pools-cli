# Shared Anvil Contract Fixture

This directory is a committed test-only snapshot of the minimal contract artifacts
the shared Anvil harness needs to deploy the local protocol fixture.

- It is for repository tests only.
- It is not published in the npm package.
- Standard Anvil test commands read this fixture directly and do not require an
  external contracts checkout or extra contracts-specific environment setup.

Refresh it intentionally from a prepared upstream contracts workspace:

```bash
npm run anvil:fixture:refresh -- --contracts-root /path/to/privacy-pools-core/packages/contracts
```
