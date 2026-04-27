import {
  OUTPUT_FORMAT_DESCRIPTION,
  OUTPUT_FORMATS,
} from "./mode.js";

interface RootGlobalFlagEntry {
  flag: string;
  description: string;
  takesValue: boolean;
  welcomeBoolean: boolean;
  values?: readonly string[];
  hidden?: boolean;
}

export const ROOT_GLOBAL_FLAG_METADATA: readonly RootGlobalFlagEntry[] = [
  {
    flag: "-c, --chain <name>",
    description: "Target chain (mainnet, arbitrum, optimism, ...)",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "-j, --json",
    description:
      "Machine-readable JSON output on stdout. After the command name, pass --json <fields> or --json=<fields> to select top-level fields.",
    takesValue: false,
    welcomeBoolean: false,
  },
  {
    flag: "--json-fields <fields>",
    description: "Select specific JSON fields (comma-separated, implies --json)",
    takesValue: true,
    welcomeBoolean: false,
    hidden: true,
  },
  {
    flag: "--template <template>",
    description: "Render structured output through a lightweight Mustache-style template with {{path.to.value}} placeholders and {{#items}}...{{/items}} list iteration",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "-o, --output <format>",
    description: OUTPUT_FORMAT_DESCRIPTION,
    takesValue: true,
    welcomeBoolean: false,
    values: [...OUTPUT_FORMATS],
  },
  {
    flag: "-y, --yes",
    description: "Skip confirmation prompts",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--web",
    description: "Open the primary explorer or portal link in your browser when available",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--help-brief",
    description: "Show condensed command help (default)",
    takesValue: false,
    welcomeBoolean: false,
  },
  {
    flag: "--help-full",
    description: "Show full command help with examples, safety notes, and JSON fields",
    takesValue: false,
    welcomeBoolean: false,
  },
  {
    flag: "-r, --rpc-url <url>",
    description: "Override RPC URL",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "--agent",
    description: "Machine-friendly mode (alias for --json --yes --quiet)",
    takesValue: false,
    welcomeBoolean: false,
  },
  {
    flag: "-q, --quiet",
    description: "Suppress human-oriented stderr output",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--no-banner",
    description: "Disable welcome banner output",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "-v, --verbose",
    description: "Enable verbose/debug output (-v info, -vv debug, -vvv trace)",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--no-progress",
    description: "Suppress spinners/progress indicators (useful in CI)",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--no-header",
    description: "Suppress header rows in CSV and wide/tabular table output",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--timeout <seconds>",
    description: "Network/transaction timeout in seconds (default: 30)",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "--jmes <expression>",
    description: "Filter JSON output with a JMESPath expression (implies --json)",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "--jq <expression>",
    description: "Compatibility alias for --jmes (JMESPath, not jq syntax)",
    takesValue: true,
    welcomeBoolean: false,
  },
  {
    flag: "--no-color",
    description: "Disable colored output (also respects NO_COLOR env var)",
    takesValue: false,
    welcomeBoolean: true,
  },
  {
    flag: "--profile <name>",
    description: "Use a named profile (separate wallet identity and config)",
    takesValue: true,
    welcomeBoolean: false,
  },
] as const;

export type RootGlobalFlagMetadata = RootGlobalFlagEntry;
export type RootGlobalFlag = RootGlobalFlagMetadata["flag"] | string;

function splitFlagNames(flag: string): string[] {
  return flag
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

const ROOT_GLOBAL_FLAG_DESCRIPTIONS = new Map<string, string>(
  ROOT_GLOBAL_FLAG_METADATA.map(({ flag, description }) => [flag, description]),
);
const ROOT_GLOBAL_FLAG_VALUES = new Map<string, readonly string[]>(
  ROOT_GLOBAL_FLAG_METADATA.map((entry) => [
    entry.flag,
    entry.values ?? [],
  ]),
);

export const ROOT_OPTIONS_WITH_VALUE = new Set(
  ROOT_GLOBAL_FLAG_METADATA.filter(({ takesValue }) => takesValue).flatMap(
    ({ flag }) => splitFlagNames(flag),
  ),
);

export const ROOT_LONG_OPTIONS_WITH_INLINE_VALUE = ROOT_GLOBAL_FLAG_METADATA
  .filter(({ takesValue }) => takesValue)
  .flatMap(({ flag }) => splitFlagNames(flag).filter((name) => name.startsWith("--")));

export const ROOT_WELCOME_BOOLEAN_FLAGS = new Set(
  ROOT_GLOBAL_FLAG_METADATA.filter(({ welcomeBoolean }) => welcomeBoolean).flatMap(
    ({ flag }) => splitFlagNames(flag),
  ),
);

export function visibleRootGlobalFlagMetadata(): RootGlobalFlagMetadata[] {
  return ROOT_GLOBAL_FLAG_METADATA.filter((entry) => entry.hidden !== true);
}

function resolveRootFlagMetadata(flag: string): RootGlobalFlagMetadata | undefined {
  return ROOT_GLOBAL_FLAG_METADATA.find(
    (entry) => entry.flag === flag || splitFlagNames(entry.flag).includes(flag.split(/\s+/)[0] ?? flag),
  );
}

function rootFlagValues(
  metadata: RootGlobalFlagMetadata | undefined,
): readonly string[] {
  return metadata?.values ?? [];
}

export function rootGlobalFlagDescription(flag: RootGlobalFlag): string {
  const description =
    ROOT_GLOBAL_FLAG_DESCRIPTIONS.get(flag) ??
    resolveRootFlagMetadata(flag)?.description;
  if (!description) {
    throw new Error(`Unknown root global flag: ${flag}`);
  }
  return description;
}

export function rootGlobalFlagValues(flag: RootGlobalFlag): readonly string[] {
  const resolved = resolveRootFlagMetadata(flag);
  const values =
    ROOT_GLOBAL_FLAG_VALUES.get(flag) ??
    rootFlagValues(resolved) ??
    [];
  if (values.length === 0 && !resolved) {
    throw new Error(`Unknown root global flag: ${flag}`);
  }
  return values;
}
