import { spawn } from "node:child_process";
import { withRepoBinPath } from "./env.mjs";
import {
  fixtureServerScript,
  syncGateRpcServerScript,
} from "./constants.mjs";
import { getRpcFixtureConfigs } from "./matrix.mjs";

function launchServer({
  script,
  readyPattern,
  timeoutMs,
  env,
  timeoutMessage,
  exitLabel,
}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["--import", "tsx", script], {
      stdio: ["ignore", "pipe", "ignore"],
      env: withRepoBinPath(env, { disableNative: false }),
    });

    let output = "";
    let settled = false;

    const cleanupListeners = () => {
      proc.off("error", handleError);
      proc.off("exit", handleExit);
      proc.stdout?.off("data", handleData);
    };

    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanupListeners();
      resolve(value);
    };

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanupListeners();
      reject(error);
    };

    const timeout = setTimeout(() => {
      proc.kill();
      settleReject(new Error(timeoutMessage));
    }, timeoutMs);

    const handleData = (chunk) => {
      output += chunk.toString();
      const match = output.match(readyPattern);
      if (!match) return;
      const port = Number(match[1]);
      settleResolve({
        proc,
        port,
        url: `http://127.0.0.1:${port}`,
      });
    };

    const handleError = (error) => {
      settleReject(error);
    };

    const handleExit = (code) => {
      settleReject(new Error(`${exitLabel} exited early with code ${code}`));
    };

    proc.stdout?.on("data", handleData);
    proc.once("error", handleError);
    proc.once("exit", handleExit);
  });
}

function stopChildProcess(child) {
  return new Promise((resolve) => {
    if (!child) {
      resolve();
      return;
    }
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill();
  });
}

function launchAspFixtureServer() {
  return launchServer({
    script: fixtureServerScript,
    readyPattern: /FIXTURE_PORT=(\d+)/,
    timeoutMs: 10_000,
    env: {},
    timeoutMessage: "Fixture server did not start within 10s",
    exitLabel: "Fixture server",
  });
}

function launchSyncGateRpcServer(config) {
  return launchServer({
    script: syncGateRpcServerScript,
    readyPattern: /SYNC_GATE_RPC_PORT=(\d+)/,
    timeoutMs: 10_000,
    env: {
      PP_SYNC_RPC_CHAIN_ID: String(config.chainId),
      PP_SYNC_RPC_ENTRYPOINT: config.entrypoint,
      PP_SYNC_RPC_POOL: config.poolAddress,
      PP_SYNC_RPC_SCOPE: config.scope.toString(),
      PP_SYNC_RPC_BLOCK_NUMBER:
        config.blockNumber === undefined ? undefined : config.blockNumber.toString(),
    },
    timeoutMessage: "Sync-gate RPC server did not start within 10s",
    exitLabel: "Sync-gate RPC server",
  });
}

export async function launchBenchFixtures() {
  const aspFixture = await launchAspFixtureServer();
  const rpcServerEntries = [];
  const rpcUrls = {};

  try {
    for (const [chainName, config] of Object.entries(getRpcFixtureConfigs())) {
      const server = await launchSyncGateRpcServer(config);
      rpcServerEntries.push(server);
      rpcUrls[chainName] = server.url;
    }

    return {
      fixtureUrl: aspFixture.url,
      rpcUrls,
      async stop() {
        await Promise.allSettled([
          stopChildProcess(aspFixture.proc),
          ...rpcServerEntries.map((entry) => stopChildProcess(entry.proc)),
        ]);
      },
    };
  } catch (error) {
    await Promise.allSettled([
      stopChildProcess(aspFixture.proc),
      ...rpcServerEntries.map((entry) => stopChildProcess(entry.proc)),
    ]);
    throw error;
  }
}
