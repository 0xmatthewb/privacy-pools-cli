import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";
import type { ChainConfig } from "../types.js";

interface SharedAnvilOverrideFile {
  chainName: string;
  chainId: number;
  entrypoint: `0x${string}`;
  startBlock: number;
}

let cachedOverrideFilePath: string | null = null;
let cachedOverrideFile: SharedAnvilOverrideFile | null = null;

function loadSharedAnvilOverrideFile(): SharedAnvilOverrideFile | null {
  if (process.env.PP_ANVIL_E2E !== "1") {
    return null;
  }

  const file = process.env.PP_ANVIL_SHARED_ENV_FILE?.trim();
  if (!file) {
    return null;
  }

  const resolvedFile = resolve(file);
  if (cachedOverrideFilePath === resolvedFile) {
    return cachedOverrideFile;
  }

  const parsed = JSON.parse(
    readFileSync(resolvedFile, "utf8"),
  ) as SharedAnvilOverrideFile;

  cachedOverrideFilePath = resolvedFile;
  cachedOverrideFile = parsed;
  return parsed;
}

export function resolveSharedAnvilChainOverride(
  config: ChainConfig,
): Pick<ChainConfig, "entrypoint" | "startBlock"> | null {
  const sharedOverride = loadSharedAnvilOverrideFile();
  if (!sharedOverride) {
    return null;
  }

  if (
    sharedOverride.chainName !== config.name
    || sharedOverride.chainId !== config.id
  ) {
    return null;
  }

  return {
    entrypoint: sharedOverride.entrypoint as Address,
    startBlock: BigInt(sharedOverride.startBlock),
  };
}

export function resetSharedAnvilChainOverrideCacheForTests(): void {
  cachedOverrideFilePath = null;
  cachedOverrideFile = null;
}
