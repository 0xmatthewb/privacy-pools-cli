export const ROOT_HELP_FOOTER_ENTRIES = [
  ["Get started:", "privacy-pools init"],
  ["Full guide:", "privacy-pools guide"],
  ["Command help:", "privacy-pools <command> --help"],
  ["Agent discovery:", "privacy-pools capabilities"],
] as const;

const COMMAND_GROUPS = [
  ["Setup", "init, config, upgrade"],
  ["Transact", "deposit, withdraw, ragequit, flow"],
  ["Monitor", "accounts, status, history, activity, sync, stats"],
  ["Discover", "pools, guide, describe, capabilities, completion"],
] as const;

export function rootHelpFooterPlain(): string {
  return [
    "",
    "Command Groups:",
    ...COMMAND_GROUPS.map(
      ([label, commands]) => `  ${label.padEnd(12)}${commands}`,
    ),
    "",
    ...ROOT_HELP_FOOTER_ENTRIES.map(
      ([label, command]) => `  ${label.padEnd(18)}${command}`,
    ),
  ].join("\n");
}

export async function rootHelpFooterStyled(): Promise<string> {
  const { accent } = await import("./theme.js");
  const chalk = (await import("chalk")).default;
  return [
    "",
    chalk.bold("Command Groups:"),
    ...COMMAND_GROUPS.map(
      ([label, commands]) => `  ${chalk.dim(label.padEnd(12))}${accent(commands)}`,
    ),
    "",
    ...ROOT_HELP_FOOTER_ENTRIES.map(
      ([label, command]) => `  ${label.padEnd(18)}${accent(command)}`,
    ),
  ].join("\n");
}
