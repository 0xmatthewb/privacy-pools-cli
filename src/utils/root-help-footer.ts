import { ROOT_COMMAND_GROUPS } from "./root-command-groups.js";

export const ROOT_HELP_FOOTER_ENTRIES = [
  ["Get started:", "privacy-pools init"],
  ["Full guide:", "privacy-pools guide"],
  ["Command help:", "privacy-pools <command> --help"],
  ["Agent discovery:", "privacy-pools capabilities"],
  ["Agent skill:", "skills/privacy-pools-cli/SKILL.md"],
] as const;

const COMMON_WORKFLOWS = [
  ["Easy path", "privacy-pools flow start 0.1 ETH --to <address>"],
  ["Manual path", "privacy-pools deposit 0.1 ETH"],
  ["Watch review", "privacy-pools accounts --chain mainnet --pending-only"],
  ["Withdraw", "privacy-pools withdraw --all ETH --to <address>"],
] as const;

const COMMAND_GROUPS = ROOT_COMMAND_GROUPS.map(
  (group) => [group.heading, group.commands.join(", ")] as const,
);

export function rootHelpFooterPlain(): string {
  return [
    "",
    "Common workflows:",
    ...COMMON_WORKFLOWS.map(
      ([label, command]) => `  ${label.padEnd(18)}${command}`,
    ),
    "",
    ...ROOT_HELP_FOOTER_ENTRIES.map(
      ([label, command]) => `  ${label.padEnd(18)}${command}`,
    ),
  ].join("\n");
}

export async function rootHelpFooterStyled(): Promise<string> {
  const { accent, muted } = await import("./theme.js");
  const chalk = (await import("chalk")).default;
  const commandGroupLabelWidth = 18;
  return [
    "",
    chalk.bold("Command Groups:"),
    ...COMMAND_GROUPS.map(
      ([label, commands]) =>
        `  ${muted(label.padEnd(commandGroupLabelWidth))}${accent(commands)}`,
    ),
    "",
    chalk.bold("Common workflows:"),
    ...COMMON_WORKFLOWS.map(
      ([label, command]) => `  ${muted(label.padEnd(18))}${accent(command)}`,
    ),
    "",
    ...ROOT_HELP_FOOTER_ENTRIES.map(
      ([label, command]) => `  ${label.padEnd(18)}${accent(command)}`,
    ),
  ].join("\n");
}
