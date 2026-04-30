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
