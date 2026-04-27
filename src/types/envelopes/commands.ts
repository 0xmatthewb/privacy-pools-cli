import type { z } from "zod";
import { COMMAND_PATHS, type CommandPath } from "../../utils/command-catalog.js";
import { cliEnvelopeSchema } from "./common.js";

export const commandEnvelopeSchemas = Object.fromEntries(
  COMMAND_PATHS.map((command) => [command, cliEnvelopeSchema.describe(command)]),
) as Record<CommandPath, typeof cliEnvelopeSchema>;

export type CommandEnvelopeSchemas = typeof commandEnvelopeSchemas;
export type CommandEnvelope = z.infer<typeof cliEnvelopeSchema>;
