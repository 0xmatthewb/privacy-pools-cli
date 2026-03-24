import { accent } from "./theme.js";

export function rootHelpFooter(): string {
  return [
    "",
    `  Get started:      ${accent("privacy-pools init")}`,
    `  Full guide:       ${accent("privacy-pools guide")}`,
    `  Command help:     ${accent("privacy-pools <command> --help")}`,
    `  Agent discovery:  ${accent("privacy-pools capabilities")}`,
  ].join("\n");
}
