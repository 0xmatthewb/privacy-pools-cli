import type { Command } from "commander";
import type { DeprecationWarningPayload } from "../output/deprecation.js";

const ROOT_ALIAS_DEPRECATION_WARNING = Symbol.for(
  "privacy-pools.rootAliasDeprecationWarning",
);

type CommandWithRootAliasMetadata = Command & {
  [ROOT_ALIAS_DEPRECATION_WARNING]?: DeprecationWarningPayload;
};

export function setCommandAliasDeprecationWarning(
  command: Command,
  warning: DeprecationWarningPayload | undefined,
): void {
  if (!warning) return;
  (command as CommandWithRootAliasMetadata)[ROOT_ALIAS_DEPRECATION_WARNING] =
    warning;
}

export function getCommandAliasDeprecationWarning(
  command: Command,
): DeprecationWarningPayload | undefined {
  return (command as CommandWithRootAliasMetadata)[
    ROOT_ALIAS_DEPRECATION_WARNING
  ];
}
