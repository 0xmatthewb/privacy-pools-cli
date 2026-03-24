export const ROOT_HELP_FOOTER_ENTRIES = [
  ["Get started:", "privacy-pools init"],
  ["Full guide:", "privacy-pools guide"],
  ["Command help:", "privacy-pools <command> --help"],
  ["Agent discovery:", "privacy-pools capabilities"],
] as const;

export function rootHelpFooterPlain(): string {
  return [
    "",
    ...ROOT_HELP_FOOTER_ENTRIES.map(
      ([label, command]) => `  ${label.padEnd(18)}${command}`,
    ),
  ].join("\n");
}

export async function rootHelpFooterStyled(): Promise<string> {
  const { accent } = await import("./theme.js");
  return [
    "",
    ...ROOT_HELP_FOOTER_ENTRIES.map(
      ([label, command]) => `  ${label.padEnd(18)}${accent(command)}`,
    ),
  ].join("\n");
}
