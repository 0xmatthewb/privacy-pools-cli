const allowDirect = process.env.PP_TEST_ALLOW_DIRECT === "1";
const runId = process.env.PP_TEST_RUN_ID;

if (!allowDirect && !runId) {
  process.stderr.write(
    [
      "[bun-preload-guard] Direct `bun test` invocation detected.",
      "This repo's tests must be run through the harness:",
      "  node scripts/run-bun-tests.mjs <files...>",
      "or the npm scripts (`npm test`, `npm run test:offline`, etc.).",
      "",
      "To bypass for `bun test --watch` or external CI:",
      "  PP_TEST_ALLOW_DIRECT=1 bun test ...",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Scrub CI-detection env keys at process startup so every test runs with
// deterministic mode/upgrade-context behavior regardless of host runner.
// The global-mode resolver (src/utils/mode.ts) and the upgrade-service
// install-context detection both short-circuit on CI/GITHUB_ACTIONS, which
// breaks any test asserting on the non-CI branches. Tests that need to
// exercise CI-specific behavior can set these explicitly within the test.
for (const key of ["CI", "GITHUB_ACTIONS", "BUILDKITE"]) {
  delete process.env[key];
}

// Force a deterministic terminal width for renderers that branch on
// getOutputWidthClass() (narrow vs wide layout). GitHub Actions runners
// report a small column count (~70), which flips human-mode output to the
// stacked layout and breaks renderStatus/withdraw/history exact-match
// assertions. PRIVACY_POOLS_CLI_PREVIEW_COLUMNS is the highest-priority
// width source (src/utils/terminal.ts); COLUMNS is a fallback for any
// helper that reads it directly.
process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS = "120";
process.env.COLUMNS = "120";
