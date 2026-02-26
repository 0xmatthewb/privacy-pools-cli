import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CLI_ROOT = resolve(__dirname, "..", "..");

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export const CORE_REPO_ROOT =
  nonEmptyEnv("PP_CORE_REPO_ROOT")
  ?? resolve(CLI_ROOT, "..", "..", "docs", "privacy-pools-core-main");

export const FRONTEND_REPO_ROOT =
  nonEmptyEnv("PP_FRONTEND_REPO_ROOT")
  ?? resolve(CLI_ROOT, "..", "..", "docs", "privacy-pools-website-main");

export function pathExists(path: string): boolean {
  return existsSync(path);
}
