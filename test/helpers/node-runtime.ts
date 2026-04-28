import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function nodeExecutable(): string {
  return process.platform === "win32" ? "node.exe" : "node";
}

export function tsxEntrypointArgs(script: string): string[] {
  return [
    "--import",
    "./src/runtime/color-env-bootstrap.ts",
    "--import",
    "tsx",
    script,
  ];
}

export function isDirectEntrypoint(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === resolve(fileURLToPath(moduleUrl));
}
