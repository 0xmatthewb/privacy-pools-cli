import { spawnSync } from "node:child_process";

export function spawnOrThrow(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...opts,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || result.stdout?.trim() || "";
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${stderr}`);
  }
  return result;
}
