import { formatCallout } from "./layout.js";

export interface DeprecationWarningPayload {
  code: string;
  message: string;
  replacementCommand: string;
}

export function formatDeprecationWarningCallout(
  warning: DeprecationWarningPayload,
): string {
  return formatCallout("warning", [
    warning.message,
    `Replacement: ${warning.replacementCommand}`,
  ]);
}
