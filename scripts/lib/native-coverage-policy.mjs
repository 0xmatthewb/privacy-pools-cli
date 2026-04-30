export const NATIVE_COVERAGE_EXCLUDED_SOURCES = new Set([
  "native/shell/src/test_env.rs",
]);

export const NATIVE_COVERAGE_FAMILIES = [
  {
    label: "native-root-argv",
    min: 90,
    enforced: true,
    matchers: ["native/shell/src/root_argv.rs"],
  },
  {
    label: "native-completion",
    min: 90,
    enforced: true,
    matchers: ["native/shell/src/completion.rs"],
  },
  {
    label: "native-routing",
    min: 85,
    enforced: true,
    matchers: ["native/shell/src/routing.rs"],
  },
  {
    label: "native-host",
    min: 85,
    enforced: true,
    matchers: [
      "native/shell/src/bridge.rs",
      "native/shell/src/dispatch.rs",
      "native/shell/src/main.rs",
    ],
  },
  {
    label: "native-core-utils",
    min: 85,
    enforced: true,
    matchers: [
      "native/shell/src/config.rs",
      "native/shell/src/contract.rs",
      "native/shell/src/error.rs",
      "native/shell/src/http_client.rs",
      "native/shell/src/json.rs",
      "native/shell/src/known_addresses.rs",
      "native/shell/src/output.rs",
      "native/shell/src/read_only_api.rs",
    ],
  },
  {
    label: "native-activity",
    min: 85,
    enforced: true,
    matchers: ["native/shell/src/commands/pools/activity/"],
  },
  {
    label: "native-stats",
    min: 85,
    enforced: true,
    matchers: ["native/shell/src/commands/pools/stats.rs"],
  },
  {
    label: "native-pools",
    min: 85,
    enforced: true,
    matchers: [
      "native/shell/src/commands/pools.rs",
      "native/shell/src/commands/pools/helpers.rs",
      "native/shell/src/commands/pools/model.rs",
      "native/shell/src/commands/pools/query.rs",
      "native/shell/src/commands/pools/query_chain_selection.rs",
      "native/shell/src/commands/pools/query_execution.rs",
      "native/shell/src/commands/pools/query_resolution.rs",
      "native/shell/src/commands/pools/render.rs",
      "native/shell/src/commands/pools/rpc.rs",
      "native/shell/src/commands/pools/rpc_abi.rs",
      "native/shell/src/commands/pools/rpc_cache.rs",
      "native/shell/src/commands/pools/rpc_token.rs",
      "native/shell/src/commands/pools/rpc_transport.rs",
    ],
  },
];

export const NATIVE_COVERAGE_DIAGNOSTICS = [
  {
    label: "native-bootstrap",
    matchers: [
      "native/shell/src/root_argv.rs",
      "native/shell/src/completion.rs",
      "native/shell/src/routing.rs",
    ],
  },
  {
    label: "native-pools-query",
    matchers: [
      "native/shell/src/commands/pools/query.rs",
      "native/shell/src/commands/pools/query_chain_selection.rs",
      "native/shell/src/commands/pools/query_execution.rs",
      "native/shell/src/commands/pools/query_resolution.rs",
    ],
  },
  {
    label: "native-pools-rpc",
    matchers: [
      "native/shell/src/commands/pools/rpc.rs",
      "native/shell/src/commands/pools/rpc_abi.rs",
      "native/shell/src/commands/pools/rpc_cache.rs",
      "native/shell/src/commands/pools/rpc_token.rs",
      "native/shell/src/commands/pools/rpc_transport.rs",
    ],
  },
  {
    label: "native-pools-shared",
    matchers: [
      "native/shell/src/commands/pools/helpers.rs",
      "native/shell/src/commands/pools/render.rs",
      "native/shell/src/commands/pools/model.rs",
    ],
  },
];

export function normalizeNativeCoveragePath(value) {
  return value.replaceAll("\\", "/");
}

export function nativeCoverageSourceMatches(source, matcher) {
  return matcher.endsWith("/")
    ? source.startsWith(matcher)
    : source === matcher;
}

export function classifyNativeCoverageSources(sources) {
  const matched = new Map();
  const unmatched = [];
  const multiplyMatched = [];

  for (const source of sources) {
    if (NATIVE_COVERAGE_EXCLUDED_SOURCES.has(source)) {
      continue;
    }
    const families = NATIVE_COVERAGE_FAMILIES.filter((family) =>
      family.matchers.some((matcher) => nativeCoverageSourceMatches(source, matcher))
    ).map((family) => family.label);
    if (families.length === 1) {
      matched.set(source, families[0]);
      continue;
    }
    if (families.length === 0) {
      unmatched.push(source);
      continue;
    }
    multiplyMatched.push({ source, families });
  }

  return { matched, unmatched, multiplyMatched };
}
