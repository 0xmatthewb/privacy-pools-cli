import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildChildProcessEnv } from "./child-env.ts";
import {
  registerProcessExitCleanup,
  terminateChildProcess,
} from "./process.ts";

export interface AnvilInstance {
  proc: ChildProcess;
  port: number;
  url: string;
  cleanup?: () => void;
}

interface LaunchAnvilOptions {
  chainId: number;
  forkUrl?: string;
  forkBlockNumber?: bigint;
}

function resolveAnvilBinary(): string {
  const envOverride = process.env.PP_ANVIL_BIN?.trim();
  if (envOverride) return envOverride;

  const foundryBinDir = join(homedir(), ".foundry", "bin");
  const foundryDefault = join(
    foundryBinDir,
    process.platform === "win32" ? "anvil.exe" : "anvil"
  );
  if (existsSync(foundryDefault)) {
    return foundryDefault;
  }

  return "anvil";
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a free TCP port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

export async function anvilRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[] = []
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const payload = await response.json() as {
    result?: T;
    error?: { code?: number; message?: string };
  };

  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message
        ? `${method} failed: ${payload.error.message}`
        : `${method} failed with HTTP ${response.status}`
    );
  }

  return payload.result as T;
}

async function waitForRpc(rpcUrl: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await anvilRpc<string>(rpcUrl, "eth_chainId");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for Anvil RPC");
}

export async function launchAnvil(
  options: LaunchAnvilOptions
): Promise<AnvilInstance> {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const binary = resolveAnvilBinary();

  const args = [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--chain-id", String(options.chainId),
    "--silent",
  ];

  if (options.forkUrl) {
    args.push("--fork-url", options.forkUrl);
  }

  if (options.forkBlockNumber !== undefined) {
    args.push("--fork-block-number", options.forkBlockNumber.toString());
  }

  let recentStderr = "";
  let earlyExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;

  const proc = spawn(binary, args, {
    stdio: ["ignore", "ignore", "pipe"],
    env: buildChildProcessEnv(),
  });
  const cleanupProcessExit = registerProcessExitCleanup(proc);
  const spawnFailure = new Promise<never>((_, reject) => {
    proc.once("error", reject);
  });

  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => {
    recentStderr = (recentStderr + chunk).slice(-2_000);
  });
  proc.once("exit", (code, signal) => {
    earlyExit = { code, signal };
  });

  try {
    await Promise.race([waitForRpc(url), spawnFailure]);
  } catch (error) {
    cleanupProcessExit();
    proc.kill();
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Failed to launch Anvil from '${binary}': command not found. `
        + "Install Foundry from https://www.getfoundry.sh/anvil or set PP_ANVIL_BIN."
      );
    }
    if (earlyExit) {
      const exitSummary = earlyExit.code !== null
        ? `exit code ${earlyExit.code}`
        : `signal ${earlyExit.signal ?? "unknown"}`;
      const stderrSummary = recentStderr.trim();
      throw new Error(
        `Anvil exited before its RPC became ready (${exitSummary}).`
        + (stderrSummary ? ` stderr: ${stderrSummary}` : "")
      );
    }
    throw error;
  }

  proc.stderr?.removeAllListeners("data");
  proc.stderr?.destroy();
  proc.unref();

  return { proc, port, url, cleanup: cleanupProcessExit };
}

export async function killAnvil(anvil: AnvilInstance): Promise<void> {
  anvil.cleanup?.();
  await terminateChildProcess(anvil.proc);
}

export async function setBalance(
  rpcUrl: string,
  address: string,
  amount: bigint
): Promise<void> {
  await anvilRpc(rpcUrl, "anvil_setBalance", [
    address,
    `0x${amount.toString(16)}`,
  ]);
}

export async function impersonateAccount(
  rpcUrl: string,
  address: string
): Promise<void> {
  await anvilRpc(rpcUrl, "anvil_impersonateAccount", [address]);
}

export async function stopImpersonatingAccount(
  rpcUrl: string,
  address: string
): Promise<void> {
  await anvilRpc(rpcUrl, "anvil_stopImpersonatingAccount", [address]);
}

export async function snapshotState(rpcUrl: string): Promise<string> {
  return anvilRpc<string>(rpcUrl, "evm_snapshot");
}

export async function revertState(
  rpcUrl: string,
  snapshotId: string
): Promise<boolean> {
  return anvilRpc<boolean>(rpcUrl, "evm_revert", [snapshotId]);
}
