import type { GlobalOptions } from "../types.js";

let activeNextActionGlobals: GlobalOptions = {};

export function configureNextActionGlobals(
  globalOpts: GlobalOptions | undefined,
): void {
  activeNextActionGlobals = globalOpts ? { ...globalOpts } : {};
}

export function getNextActionGlobals(): GlobalOptions {
  return { ...activeNextActionGlobals };
}
