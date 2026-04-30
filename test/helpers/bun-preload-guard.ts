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
// report a small column count (~70) via process.stdout.columns, which
// flips human-mode output to the stacked layout and breaks
// renderStatus/withdraw/history exact-match assertions.
//
// We set COLUMNS (not PRIVACY_POOLS_CLI_PREVIEW_COLUMNS) because the
// latter has higher priority in src/utils/terminal.ts and would
// override per-test narrow-mode simulation (banner.render
// narrow-tty, output-csv printTable narrow). COLUMNS=120 wins
// against process.stdout.columns but stays subordinate to
// PRIVACY_POOLS_CLI_PREVIEW_COLUMNS, which tests can set
// explicitly when they want to simulate a specific width.
process.env.COLUMNS = "120";

// Defense in depth: clear any test-leaked own-property descriptor on
// process.stderr.columns / process.stdout.columns before tests run.
// format-matrix.unit.test.ts has historically left a 72-col getter in
// place when originalColumns was undefined (CI runners have no TTY);
// that leak made getTerminalColumns() fall through to a stale 72 in
// downstream tests and pushed renderers into narrow layout despite
// COLUMNS=120 being set. The format-matrix.unit.test.ts restore was
// fixed too, but this preload-time wipe is cheap insurance for any
// future leak.
for (const stream of [process.stderr, process.stdout] as const) {
  if (Object.getOwnPropertyDescriptor(stream, "columns")) {
    Reflect.deleteProperty(stream, "columns");
  }
}
