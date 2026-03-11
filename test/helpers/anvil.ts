import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

export interface AnvilInstance {
  proc: ChildProcess;
  port: number;
  url: string;
}

interface LaunchAnvilOptions {
  forkUrl: string;
  chainId: number;
  forkBlockNumber?: bigint;
}

function resolveAnvilBinary(): string {
  const envOverride = process.env.PP_ANVIL_BIN?.trim();
  if (envOverride) return envOverride;

  const windowsDefault = "C:\\Users\\studi\\.foundry\\bin\\anvil.exe";
  if (process.platform === "win32" && existsSync(windowsDefault)) {
    return windowsDefault;
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
    headers: { "Content-Type": "application/json" },
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

  const args = [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--fork-url", options.forkUrl,
    "--chain-id", String(options.chainId),
    "--silent",
  ];

  if (options.forkBlockNumber !== undefined) {
    args.push("--fork-block-number", options.forkBlockNumber.toString());
  }

  const proc = spawn(resolveAnvilBinary(), args, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  try {
    await waitForRpc(url);
  } catch (error) {
    proc.kill();
    throw error;
  }

  return { proc, port, url };
}

export function killAnvil(anvil: AnvilInstance): void {
  anvil.proc.kill();
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
