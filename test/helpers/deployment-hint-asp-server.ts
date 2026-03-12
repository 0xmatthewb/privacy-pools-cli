import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

interface DeploymentHintAspConfig {
  chainId: number;
  assetAddress: `0x${string}`;
  tokenSymbol: string;
  scope: bigint;
}

export interface DeploymentHintAspServer {
  proc: ChildProcess;
  port: number;
  url: string;
}

function parseConfigFromEnv(): DeploymentHintAspConfig {
  const chainId = Number(process.env.PP_DEPLOYMENT_HINT_ASP_CHAIN_ID ?? "");
  const assetAddress = process.env.PP_DEPLOYMENT_HINT_ASP_ASSET as `0x${string}` | undefined;
  const tokenSymbol = process.env.PP_DEPLOYMENT_HINT_ASP_SYMBOL;
  const scopeRaw = process.env.PP_DEPLOYMENT_HINT_ASP_SCOPE;

  if (!Number.isInteger(chainId) || !assetAddress || !tokenSymbol || !scopeRaw) {
    throw new Error("Missing deployment-hint ASP server configuration");
  }

  return {
    chainId,
    assetAddress,
    tokenSymbol,
    scope: BigInt(scopeRaw),
  };
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function route(
  req: IncomingMessage,
  res: ServerResponse,
  config: DeploymentHintAspConfig
): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method !== "GET") {
    writeJson(res, 405, { message: "Method Not Allowed" });
    return;
  }

  if (path === `/${config.chainId}/public/pools-stats`) {
    writeJson(res, 200, {
      pools: [
        {
          scope: config.scope.toString(),
          chainId: config.chainId,
          tokenAddress: config.assetAddress,
          tokenSymbol: config.tokenSymbol,
          totalInPoolValue: "0",
          totalDepositsValue: "0",
          acceptedDepositsValue: "0",
          pendingDepositsValue: "0",
          totalDepositsCount: 0,
          acceptedDepositsCount: 0,
          pendingDepositsCount: 0,
        },
      ],
    });
    return;
  }

  if (path === `/${config.chainId}/public/mt-leaves`) {
    writeJson(res, 200, {
      aspLeaves: [],
      stateTreeLeaves: [],
    });
    return;
  }

  if (path === `/${config.chainId}/health/liveness`) {
    writeJson(res, 200, { status: "ok" });
    return;
  }

  writeJson(res, 404, { message: "Not Found" });
}

export function launchDeploymentHintAspServer(
  config: DeploymentHintAspConfig
): Promise<DeploymentHintAspServer> {
  const script = resolve(import.meta.dir, "deployment-hint-asp-server.ts");

  return new Promise((resolvePromise, reject) => {
    const proc = spawn("bun", ["run", script], {
      stdio: ["ignore", "pipe", "ignore"],
      detached: false,
      env: {
        ...process.env,
        PP_DEPLOYMENT_HINT_ASP_CHAIN_ID: String(config.chainId),
        PP_DEPLOYMENT_HINT_ASP_ASSET: config.assetAddress,
        PP_DEPLOYMENT_HINT_ASP_SYMBOL: config.tokenSymbol,
        PP_DEPLOYMENT_HINT_ASP_SCOPE: config.scope.toString(),
      },
    });

    let output = "";
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Deployment-hint ASP server did not start within 10s"));
    }, 10_000);

    proc.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/DEPLOYMENT_HINT_ASP_PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        const port = Number(match[1]);
        resolvePromise({ proc, port, url: `http://127.0.0.1:${port}` });
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Deployment-hint ASP server exited early with code ${code}`));
    });
  });
}

export function killDeploymentHintAspServer(server: DeploymentHintAspServer): void {
  server.proc.kill();
}

if (import.meta.main) {
  const config = parseConfigFromEnv();
  const server = createServer((req, res) => route(req, res, config));

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    process.stdout.write(`DEPLOYMENT_HINT_ASP_PORT=${addr.port}\n`);
  });
}
