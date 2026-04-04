import { homedir } from "node:os";
import { join } from "node:path";

export function resolveConfigHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.PRIVACY_POOLS_HOME?.trim() ||
    env.PRIVACY_POOLS_CONFIG_DIR?.trim() ||
    join(homedir(), ".privacy-pools")
  );
}

export function resolveConfigPath(
  segments: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveConfigHome(env), ...segments);
}
