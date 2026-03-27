import {
  GENERATED_CAPABILITIES_PAYLOAD,
  GENERATED_COMMAND_ALIAS_MAP,
  GENERATED_COMMAND_MANIFEST,
  GENERATED_COMMAND_PATHS,
  GENERATED_STATIC_LOCAL_COMMANDS,
} from "./command-manifest.js";

export { GENERATED_COMMAND_MANIFEST, GENERATED_STATIC_LOCAL_COMMANDS };

export const STATIC_COMMAND_PATHS = GENERATED_COMMAND_PATHS;

export type StaticCommandPath = (typeof STATIC_COMMAND_PATHS)[number];

const STATIC_COMMAND_PATH_SET = new Set<string>(STATIC_COMMAND_PATHS);

const STATIC_COMMAND_ALIAS_MAP: Record<string, StaticCommandPath> =
  GENERATED_COMMAND_ALIAS_MAP;

export const STATIC_CAPABILITIES_PAYLOAD = GENERATED_CAPABILITIES_PAYLOAD;

export const STATIC_GLOBAL_FLAG_METADATA = STATIC_CAPABILITIES_PAYLOAD.globalFlags;

export function resolveStaticCommandPath(
  query: string | string[],
): StaticCommandPath | null {
  const normalized = Array.isArray(query)
    ? query.join(" ").trim().replace(/\s+/g, " ")
    : query.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return null;
  }

  if (STATIC_COMMAND_PATH_SET.has(normalized)) {
    return normalized as StaticCommandPath;
  }

  return STATIC_COMMAND_ALIAS_MAP[normalized] ?? null;
}

export function listStaticCommandPaths(): StaticCommandPath[] {
  return [...STATIC_COMMAND_PATHS];
}
