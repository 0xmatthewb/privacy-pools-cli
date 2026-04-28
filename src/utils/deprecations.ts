import type { DeprecationWarningPayload } from "../output/deprecation.js";

export type DeprecationCode =
  | "COMMAND_ALIAS_DEPRECATED"
  | "FLAG_DEPRECATED";

export type DeprecationMode = "human" | "json" | "agent";
export type DeprecationStream = "stderr" | "envelope";
export type DeprecationShape = "warning-line" | "deprecation-field";

export interface DeprecationExpectation {
  stream: DeprecationStream;
  shape: DeprecationShape;
}

export interface DeprecationInventoryEntry {
  id: string;
  kind: "command-alias" | "deprecated-command" | "deprecated-flag";
  from: string;
  to: string;
  code: DeprecationCode;
  message: string;
  replacementCommand: string;
  expectations: Partial<Record<DeprecationMode, DeprecationExpectation>>;
  testArgv?: string[];
  testExcludedReason?: string;
}

const COMMAND_ALIAS_EXPECTATIONS = {
  human: { stream: "stderr", shape: "warning-line" },
  json: { stream: "envelope", shape: "deprecation-field" },
  agent: { stream: "envelope", shape: "deprecation-field" },
} satisfies Record<DeprecationMode, DeprecationExpectation>;

export const DEPRECATION_INVENTORY = [
  {
    id: "root-recents",
    kind: "command-alias",
    from: "recents",
    to: "recipients",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command alias 'recents' is deprecated and will be removed in v3.x. Use 'recipients' instead.",
    replacementCommand: "privacy-pools recipients",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testArgv: ["recents", "list"],
  },
  {
    id: "withdraw-recipients",
    kind: "deprecated-command",
    from: "withdraw recipients",
    to: "recipients",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command 'withdraw recipients' is deprecated and will be removed in v3.x. Use 'recipients' instead.",
    replacementCommand: "privacy-pools recipients",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testArgv: ["withdraw", "recipients", "list"],
  },
  {
    id: "withdraw-recipients-list",
    kind: "deprecated-command",
    from: "withdraw recipients list",
    to: "recipients list",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command 'withdraw recipients' is deprecated and will be removed in v3.x. Use 'recipients' instead.",
    replacementCommand: "privacy-pools recipients",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testExcludedReason: "covered by withdraw recipients list invocation through the parent alias",
  },
  {
    id: "withdraw-recipients-add",
    kind: "deprecated-command",
    from: "withdraw recipients add",
    to: "recipients add",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command 'withdraw recipients' is deprecated and will be removed in v3.x. Use 'recipients' instead.",
    replacementCommand: "privacy-pools recipients",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testExcludedReason: "local address-book write",
  },
  {
    id: "withdraw-recipients-remove",
    kind: "deprecated-command",
    from: "withdraw recipients remove",
    to: "recipients remove",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command 'withdraw recipients' is deprecated and will be removed in v3.x. Use 'recipients' instead.",
    replacementCommand: "privacy-pools recipients",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testExcludedReason: "local address-book write",
  },
  {
    id: "withdraw-recipients-clear",
    kind: "deprecated-command",
    from: "withdraw recipients clear",
    to: "recipients clear",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command 'withdraw recipients' is deprecated and will be removed in v3.x. Use 'recipients' instead.",
    replacementCommand: "privacy-pools recipients",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testExcludedReason: "local address-book write",
  },
  {
    id: "stats-default",
    kind: "deprecated-command",
    from: "stats",
    to: "protocol-stats",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command 'stats global' is deprecated and will be removed in the next minor release. Use 'privacy-pools protocol-stats' instead.",
    replacementCommand: "privacy-pools protocol-stats",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testExcludedReason: "stats aliases require public ASP network data",
  },
  {
    id: "stats-global",
    kind: "deprecated-command",
    from: "stats global",
    to: "protocol-stats",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command 'stats global' is deprecated and will be removed in the next minor release. Use 'privacy-pools protocol-stats' instead.",
    replacementCommand: "privacy-pools protocol-stats",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testExcludedReason: "stats aliases require public ASP network data",
  },
  {
    id: "stats-pool",
    kind: "deprecated-command",
    from: "stats pool",
    to: "pool-stats",
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command 'stats pool' is deprecated and will be removed in the next minor release. Use 'privacy-pools pool-stats <asset>' instead.",
    replacementCommand: "privacy-pools pool-stats <asset>",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testExcludedReason: "stats aliases require public ASP and RPC pool data",
  },
  {
    id: "deposit-ignore-unique-amount",
    kind: "deprecated-flag",
    from: "deposit --ignore-unique-amount",
    to: "deposit --allow-non-round-amounts",
    code: "FLAG_DEPRECATED",
    message:
      "--ignore-unique-amount is deprecated. Use --allow-non-round-amounts instead.",
    replacementCommand:
      "privacy-pools deposit <amount> <asset> --allow-non-round-amounts",
    expectations: COMMAND_ALIAS_EXPECTATIONS,
    testExcludedReason: "deprecated flag is attached to fund-moving deposit execution",
  },
] satisfies DeprecationInventoryEntry[];

export const DEPRECATION_CODE_REGISTRY = new Set<DeprecationCode>(
  DEPRECATION_INVENTORY.map((entry) => entry.code),
);

export type DeprecationId = (typeof DEPRECATION_INVENTORY)[number]["id"];

export function getDeprecationInventoryEntry(
  id: DeprecationId,
): DeprecationInventoryEntry {
  const entry = DEPRECATION_INVENTORY.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`Unknown deprecation inventory entry '${id}'.`);
  }
  return entry;
}

export function deprecationWarningFor(
  id: DeprecationId,
  overrides: Partial<Pick<DeprecationWarningPayload, "message" | "replacementCommand">> = {},
): DeprecationWarningPayload {
  const entry = getDeprecationInventoryEntry(id);
  return {
    code: entry.code,
    message: overrides.message ?? entry.message,
    replacementCommand:
      overrides.replacementCommand ?? entry.replacementCommand,
  };
}

export function deprecatedStatsAliasWarning(
  invokedAs: "stats" | "stats global" | "stats pool",
  replacementCommand: string,
): DeprecationWarningPayload {
  const normalized = invokedAs === "stats" ? "stats global" : invokedAs;
  return deprecationWarningFor(
    normalized === "stats pool" ? "stats-pool" : "stats-global",
    {
      message:
        `Command '${normalized}' is deprecated and will be removed in the next minor release.` +
        ` Use '${replacementCommand}' instead.`,
      replacementCommand,
    },
  );
}
