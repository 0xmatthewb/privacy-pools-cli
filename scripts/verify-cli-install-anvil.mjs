import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
} from "viem";
import { sepolia } from "viem/chains";
import {
  formatResultDiagnostics,
  npmProcessEnv,
  parseArgs,
  parseJson,
  packageInstallPath,
  packTarball,
  resolveCliTarballPath,
  resolveInstalledDependencyPackagePath,
  runInstalledCli as runInstalledCliBase,
  runNpmInstallWithRetry,
  writeInstallSecretFile,
} from "./lib/install-verification.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const nativeDistributionModulePath = join(
  repoRoot,
  "src",
  "native-distribution.js",
);
const {
  nativePackageNameForTriplet,
  nativeTriplet,
} = await import(pathToFileURL(nativeDistributionModulePath).href);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
// Use a deterministic wallet that does not collide with the shared-Anvil smoke
// wallet, otherwise the installed-artifact deposit can hit PrecommitmentAlreadyUsed.
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const RELAYED_RECIPIENT = "0x4444444444444444444444444444444444444444";
const DUMMY_CID =
  "bafybeigdyrzt5sharedanvile2etests12345678901234567890";
const args = parseArgs(process.argv.slice(2));

const entrypointAbi = parseAbi([
  "function updateRoot(uint256 _root, string _ipfsCID) returns (uint256 _index)",
]);

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });

  if (result.error) {
    fail(
      `Failed to execute ${command} ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    fail(
      `Command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim(),
    );
  }

  return result;
}

function runInstalledCli(installRoot, homeDir, args, options = {}) {
  return runInstalledCliBase(installRoot, homeDir, args, {
    timeout: options.timeout ?? 300_000,
    ...options,
  });
}

function currentNativeBinaryPath() {
  const binName =
    process.platform === "win32"
      ? "privacy-pools-cli-native-shell.exe"
      : "privacy-pools-cli-native-shell";
  return join(repoRoot, "native", "shell", "target", "release", binName);
}

function currentNativePackageName(triplet) {
  return nativePackageNameForTriplet(triplet);
}

function readSharedFixtureEnv(sharedEnvFile) {
  try {
    return JSON.parse(readFileSync(resolve(sharedEnvFile), "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(
      `Failed to read shared Anvil fixture env from ${sharedEnvFile}:\n${reason}`,
    );
  }
}

async function anvilRpc(rpcUrl, method, params = []) {
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

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(
      payload?.error?.message
        ? `${method} failed: ${payload.error.message}`
        : `${method} failed with HTTP ${response.status}`,
    );
  }

  return payload.result;
}

async function setBalance(rpcUrl, address, amount) {
  await anvilRpc(rpcUrl, "anvil_setBalance", [
    address,
    `0x${amount.toString(16)}`,
  ]);
}

async function impersonateAccount(rpcUrl, address) {
  await anvilRpc(rpcUrl, "anvil_impersonateAccount", [address]);
}

async function stopImpersonatingAccount(rpcUrl, address) {
  await anvilRpc(rpcUrl, "anvil_stopImpersonatingAccount", [address]);
}

function readAspState(env) {
  return JSON.parse(readFileSync(env.aspStateFile, "utf8"));
}

function writeAspState(env, state) {
  writeFileSync(env.aspStateFile, JSON.stringify(state, null, 2), "utf8");
}

async function resetSharedFixture(env) {
  if (!env.resetStateFile) {
    fail("Shared Anvil env is missing resetStateFile.");
  }

  const resetState = JSON.parse(readFileSync(env.resetStateFile, "utf8"));
  const reverted = await anvilRpc(env.rpcUrl, "evm_revert", [
    resetState.currentSnapshotId,
  ]);
  if (!reverted) {
    fail(
      `Failed to revert shared Anvil snapshot ${resetState.currentSnapshotId}.`,
    );
  }

  writeFileSync(
    resetState.aspStateFile,
    JSON.stringify(resetState.baselineAspState, null, 2),
    "utf8",
  );

  const relayerReset = await fetch(`${resetState.relayerUrl}/__reset`, {
    method: "POST",
  });
  if (!relayerReset.ok) {
    fail(
      `Failed to reset Anvil relayer state: HTTP ${relayerReset.status}.`,
    );
  }

  resetState.currentSnapshotId = await anvilRpc(env.rpcUrl, "evm_snapshot");
  writeFileSync(env.resetStateFile, JSON.stringify(resetState, null, 2), "utf8");
}

function appendInsertedEthLeaf(env, commitment) {
  const state = readAspState(env);
  const [ethPool, ...restPools] = state.pools;
  writeAspState(env, {
    ...state,
    pools: [
      {
        ...ethPool,
        insertedStateTreeLeaves: [
          ...ethPool.insertedStateTreeLeaves,
          commitment.toString(),
        ],
      },
      ...restPools,
    ],
  });
}

function computeMerkleRoot(leaves) {
  const normalized = leaves.map((leaf) => BigInt(leaf));
  const proof = generateMerkleProof(
    normalized,
    normalized[normalized.length - 1],
  );
  return BigInt(proof.root);
}

async function approveEthLabel(env, publicClient, label) {
  const labelString = label.toString();
  const root = computeMerkleRoot([labelString]);

  await impersonateAccount(env.rpcUrl, env.postmanAddress);
  await setBalance(env.rpcUrl, env.postmanAddress, 10n ** 20n);

  try {
    const walletClient = createWalletClient({
      account: env.postmanAddress,
      chain: { ...sepolia, id: env.chainId },
      transport: http(env.rpcUrl),
    });

    const txHash = await walletClient.writeContract({
      address: env.entrypoint,
      abi: entrypointAbi,
      functionName: "updateRoot",
      args: [root, DUMMY_CID],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`updateRoot reverted: ${txHash}`);
    }
  } finally {
    await stopImpersonatingAccount(env.rpcUrl, env.postmanAddress);
  }

  const state = readAspState(env);
  const [ethPool, ...restPools] = state.pools;
  writeAspState(env, {
    ...state,
    pools: [
      {
        ...ethPool,
        approvedLabels: [...new Set([...ethPool.approvedLabels, labelString])],
        reviewStatuses: {
          ...ethPool.reviewStatuses,
          [labelString]: "approved",
        },
      },
      ...restPools,
    ],
  });
}

async function decodeEthDepositEvent(env, publicClient, txHash) {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== env.pools.eth.poolAddress.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: depositedEventAbi,
        data: log.data,
        topics: log.topics,
      });
      return {
        commitment: decoded.args._commitment,
        label: decoded.args._label,
      };
    } catch {
      // Ignore unrelated logs.
    }
  }

  throw new Error(`Deposit event not found for tx ${txHash}`);
}

function sharedAnvilCliEnv(sharedEnvFile, env) {
  const suffix = env.chainName.replace(/[^a-z0-9]/gi, "_").toUpperCase();
  return {
    PP_ANVIL_E2E: "1",
    PP_ANVIL_SHARED_ENV_FILE: resolve(sharedEnvFile),
    [`PRIVACY_POOLS_RPC_URL_${suffix}`]: env.rpcUrl,
    PRIVACY_POOLS_ASP_HOST: env.aspUrl,
    PRIVACY_POOLS_RELAYER_HOST: env.relayerUrl,
  };
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function runInstalledRelayedWithdrawWithCatchup({
  installRoot,
  homeDir,
  args,
  env,
  readyTimeout = 60_000,
  stage = "installed",
}) {
  const deadline = Date.now() + readyTimeout;
  let lastResult = null;
  let lastPayload = null;

  while (Date.now() < deadline) {
    const result = runInstalledCli(installRoot, homeDir, args, {
      env,
      timeout: 300_000,
    });
    const payload = parseJson(result.stdout, "installed withdraw --agent");

    if (result.status === 0) {
      return { result, payload };
    }

    lastResult = result;
    lastPayload = payload;

    const stillUpdating =
      payload?.success === false
      && payload?.errorCode === "ASP_ERROR"
      && payload?.errorMessage === "Withdrawal service data is still updating.";
    if (!stillUpdating) {
      break;
    }

    await delay(500);
  }

  fail(
    `Installed CLI failed ${stage} relayed withdraw parity against shared Anvil:\n${formatResultDiagnostics(lastResult ?? { status: null, stdout: JSON.stringify(lastPayload ?? {}), stderr: "" })}`,
  );
}

const sharedEnvFile = process.env.PP_ANVIL_SHARED_ENV_FILE?.trim();
if (!sharedEnvFile) {
  fail("PP_ANVIL_SHARED_ENV_FILE is required for installed Anvil artifact verification.");
}

const sharedEnv = readSharedFixtureEnv(sharedEnvFile);
const anvilClient = createPublicClient({
  chain: { ...sepolia, id: sharedEnv.chainId },
  transport: http(sharedEnv.rpcUrl),
});
const currentTriplet = nativeTriplet();

const distIndexPath = join(repoRoot, "dist", "index.js");
const requestedCliTarball = resolveCliTarballPath(args, distIndexPath);
const tempRoot = mkdtempSync(join(tmpdir(), "pp-installed-cli-anvil-"));
const cliTarballDir = join(tempRoot, "cli");
const nativePackageDir = join(tempRoot, "native-package");
const nativeTarballDir = join(tempRoot, "native-tarball");
const installRoot = join(tempRoot, "install");
const homeDir = join(installRoot, ".privacy-pools");
const missingWorkerPath = join(installRoot, "missing-worker.js");

mkdirSync(cliTarballDir, { recursive: true });
mkdirSync(nativeTarballDir, { recursive: true });
mkdirSync(installRoot, { recursive: true });

try {
  await resetSharedFixture(sharedEnv);

  const cliTarball = resolveCliTarballPath(args) ?? (() => {
    run(npmCommand, ["run", "build"]);

    if (!existsSync(distIndexPath)) {
      fail("dist/index.js not found after build.");
    }

    return packTarball(repoRoot, cliTarballDir, {
      npmStateRoot: tempRoot,
    });
  })();

  if (!currentTriplet) {
    process.stdout.write(
      `Skipping installed CLI + native Anvil verification on unsupported host ${process.platform}/${process.arch}.\n`,
    );
    process.exit(0);
  }

  const cargoCheck = spawnSync(cargoCommand, ["--version"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15_000,
  });
  if (cargoCheck.error || cargoCheck.status !== 0) {
    process.stdout.write(
      `Skipping installed CLI + native Anvil verification because cargo is unavailable on ${process.platform}/${process.arch}.\n`,
    );
    process.exit(0);
  }

  run(cargoCommand, [
    "build",
    "--manifest-path",
    "native/shell/Cargo.toml",
    "--release",
  ]);

  run("node", [
    join(repoRoot, "scripts", "prepare-native-package.mjs"),
    "--triplet",
    currentTriplet,
    "--binary",
    currentNativeBinaryPath(),
    "--out-dir",
    nativePackageDir,
  ]);
  const nativeTarball = packTarball(nativePackageDir, nativeTarballDir, {
    npmStateRoot: tempRoot,
  });
  const nativePackageName = currentNativePackageName(currentTriplet);
  if (!nativePackageName) {
    fail(`Unsupported native package triplet ${currentTriplet}.`);
  }

  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({
      name: "pp-installed-cli-anvil-check",
      private: true,
      dependencies: {
        "privacy-pools-cli": `file:${cliTarball}`,
      },
      overrides: {
        [nativePackageName]: `file:${nativeTarball}`,
      },
    }),
    "utf8",
  );

  const installResult = runNpmInstallWithRetry(
    [
      "install",
      "--silent",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    {
      cwd: installRoot,
      env: npmProcessEnv(tempRoot),
      timeout: 300_000,
    },
  );
  if (installResult.error || installResult.status !== 0) {
    fail(
      `Installed CLI Anvil verification failed to npm install prepared artifacts:\n${formatResultDiagnostics(installResult)}`,
    );
  }

  const installedCliPath = packageInstallPath(installRoot, "privacy-pools-cli");
  const installedNativePackagePath = resolveInstalledDependencyPackagePath(
    installedCliPath,
    nativePackageName,
  );
  if (!installedNativePackagePath || !existsSync(installedNativePackagePath)) {
    fail(
      `Installed CLI did not resolve ${nativePackageName} through npm optional dependencies.`,
    );
  }

  const nativeResolutionResult = runInstalledCli(
    installRoot,
    homeDir,
    ["flow", "--help"],
    {
      env: {
        PRIVACY_POOLS_CLI_JS_WORKER: missingWorkerPath,
      },
    },
  );
  if (
    nativeResolutionResult.status !== 0 ||
    !nativeResolutionResult.stdout.includes("Usage: privacy-pools flow")
  ) {
    fail(
      `Installed CLI failed native resolution parity with optional package installed:\n${formatResultDiagnostics(nativeResolutionResult)}`,
    );
  }

  const disabledNativeResolutionResult = runInstalledCli(
    installRoot,
    homeDir,
    ["flow", "--help"],
    {
      env: {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        PRIVACY_POOLS_CLI_JS_WORKER: missingWorkerPath,
      },
    },
  );
  if (disabledNativeResolutionResult.status === 0) {
    fail(
      `Installed CLI did not distinguish native resolution from JS fallback:\n${formatResultDiagnostics(disabledNativeResolutionResult)}`,
    );
  }

  const mnemonicFile = writeInstallSecretFile(
    homeDir,
    "install-anvil-mnemonic.txt",
    TEST_MNEMONIC,
  );
  const initResult = runInstalledCli(
    installRoot,
    homeDir,
    [
      "--agent",
      "init",
      "--recovery-phrase-file",
      mnemonicFile,
      "--private-key-stdin",
      "--default-chain",
      "sepolia",
      "--yes",
    ],
    {
      input: `${TEST_PRIVATE_KEY}\n`,
      timeout: 60_000,
    },
  );
  const initPayload = parseJson(
    initResult.stdout,
    "installed init --agent",
    [TEST_MNEMONIC, TEST_PRIVATE_KEY],
  );
  if (
    initResult.status !== 0 ||
    initPayload.success !== true ||
    initPayload.defaultChain !== "sepolia"
  ) {
    fail(
      `Installed CLI failed Anvil init parity:\n${formatResultDiagnostics(initResult, [TEST_MNEMONIC, TEST_PRIVATE_KEY])}`,
    );
  }

  const anvilEnv = sharedAnvilCliEnv(sharedEnvFile, sharedEnv);
  const jsFallbackAnvilEnv = {
    ...anvilEnv,
    PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
  };

  const withdrawDepositResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const withdrawDepositPayload = parseJson(
    withdrawDepositResult.stdout,
    "installed deposit --agent",
  );
  if (
    withdrawDepositResult.status !== 0 ||
    withdrawDepositPayload.success !== true ||
    withdrawDepositPayload.operation !== "deposit" ||
    typeof withdrawDepositPayload.poolAccountId !== "string"
  ) {
    fail(
      `Installed CLI failed deposit parity against shared Anvil:\n${formatResultDiagnostics(withdrawDepositResult)}`,
    );
  }

  const depositEvent = await decodeEthDepositEvent(
    sharedEnv,
    anvilClient,
    withdrawDepositPayload.txHash,
  );
  appendInsertedEthLeaf(sharedEnv, depositEvent.commitment);
  await approveEthLabel(sharedEnv, anvilClient, depositEvent.label);

  const { result: withdrawResult, payload: withdrawPayload } =
    await runInstalledRelayedWithdrawWithCatchup({
      installRoot,
      homeDir,
      args: [
        "--agent",
        "withdraw",
        "--all",
        "ETH",
        "--to",
        RELAYED_RECIPIENT,
        "--pool-account",
        withdrawDepositPayload.poolAccountId,
        "--chain",
        "sepolia",
      ],
      env: anvilEnv,
      stage: "native",
    });
  if (
    withdrawResult.status !== 0 ||
    withdrawPayload.success !== true ||
    withdrawPayload.operation !== "withdraw" ||
    withdrawPayload.mode !== "relayed" ||
    withdrawPayload.remainingBalance !== "0"
  ) {
    fail(
      `Installed CLI failed relayed withdraw parity against shared Anvil:\n${formatResultDiagnostics(withdrawResult)}`,
    );
  }

  const withdrawSyncResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "sync", "ETH", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const withdrawSyncPayload = parseJson(
    withdrawSyncResult.stdout,
    "installed sync --agent after withdraw",
  );
  if (
    withdrawSyncResult.status !== 0 ||
    withdrawSyncPayload.success !== true
  ) {
    fail(
      `Installed CLI failed sync parity after withdraw against shared Anvil:\n${formatResultDiagnostics(withdrawSyncResult)}`,
    );
  }

  const withdrawAccountsResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "accounts", "--details", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const withdrawAccountsPayload = parseJson(
    withdrawAccountsResult.stdout,
    "installed accounts --agent after withdraw",
  );
  if (
    withdrawAccountsResult.status !== 0 ||
    withdrawAccountsPayload.success !== true ||
    !Array.isArray(withdrawAccountsPayload.accounts) ||
    !withdrawAccountsPayload.accounts.some(
      (account) =>
        account?.poolAccountId === withdrawDepositPayload.poolAccountId &&
        account?.status === "spent",
    ) ||
    !Array.isArray(withdrawAccountsPayload.balances) ||
    withdrawAccountsPayload.balances.some(
      (balance) => balance?.asset === "ETH" && balance?.balance !== "0",
    )
  ) {
    fail(
      `Installed CLI failed accounts reconstruction after relayed withdraw against shared Anvil:\n${formatResultDiagnostics(withdrawAccountsResult)}`,
    );
  }

  const withdrawHistoryResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "history", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const withdrawHistoryPayload = parseJson(
    withdrawHistoryResult.stdout,
    "installed history --agent after withdraw",
  );
  if (
    withdrawHistoryResult.status !== 0 ||
    withdrawHistoryPayload.success !== true ||
    !Array.isArray(withdrawHistoryPayload.events) ||
    !withdrawHistoryPayload.events.some(
      (event) =>
        event?.type === "withdrawal"
        && event?.poolAccountId === withdrawDepositPayload.poolAccountId,
    )
  ) {
    fail(
      `Installed CLI failed history parity after relayed withdraw against shared Anvil:\n${formatResultDiagnostics(withdrawHistoryResult)}`,
    );
  }

  const depositResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const depositPayload = parseJson(
    depositResult.stdout,
    "installed second deposit --agent",
  );
  if (
    depositResult.status !== 0 ||
    depositPayload.success !== true ||
    depositPayload.operation !== "deposit" ||
    typeof depositPayload.poolAccountId !== "string"
  ) {
    fail(
      `Installed CLI failed second deposit parity against shared Anvil:\n${formatResultDiagnostics(depositResult)}`,
    );
  }

  const ragequitResult = runInstalledCli(
    installRoot,
    homeDir,
    [
      "--agent",
      "ragequit",
      "ETH",
      "--pool-account",
      depositPayload.poolAccountId,
      "--chain",
      "sepolia",
      "--confirm-ragequit",
    ],
    {
      env: anvilEnv,
    },
  );
  const ragequitPayload = parseJson(
    ragequitResult.stdout,
    "installed ragequit --agent",
  );
  if (
    ragequitResult.status !== 0 ||
    ragequitPayload.success !== true ||
    ragequitPayload.operation !== "ragequit"
  ) {
    fail(
      `Installed CLI failed ragequit parity against shared Anvil:\n${formatResultDiagnostics(ragequitResult)}`,
    );
  }

  const ragequitSyncResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "sync", "ETH", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const ragequitSyncPayload = parseJson(
    ragequitSyncResult.stdout,
    "installed sync --agent after ragequit",
  );
  if (
    ragequitSyncResult.status !== 0 ||
    ragequitSyncPayload.success !== true
  ) {
    fail(
      `Installed CLI failed sync parity after ragequit against shared Anvil:\n${formatResultDiagnostics(ragequitSyncResult)}`,
    );
  }

  const ragequitAccountsResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "accounts", "--details", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const ragequitAccountsPayload = parseJson(
    ragequitAccountsResult.stdout,
    "installed accounts --agent after ragequit",
  );
  if (
    ragequitAccountsResult.status !== 0 ||
    ragequitAccountsPayload.success !== true ||
    !Array.isArray(ragequitAccountsPayload.accounts) ||
    !ragequitAccountsPayload.accounts.some(
      (account) =>
        account?.poolAccountId === depositPayload.poolAccountId &&
        account?.status === "exited",
    ) ||
    !Array.isArray(ragequitAccountsPayload.balances) ||
    ragequitAccountsPayload.balances.some(
      (balance) => balance?.asset === "ETH" && balance?.balance !== "0",
    )
  ) {
    fail(
      `Installed CLI failed accounts reconstruction after ragequit against shared Anvil:\n${formatResultDiagnostics(ragequitAccountsResult)}`,
    );
  }

  const historyResult = runInstalledCli(
    installRoot,
    homeDir,
    ["--agent", "history", "--chain", "sepolia"],
    {
      env: anvilEnv,
    },
  );
  const historyPayload = parseJson(
    historyResult.stdout,
    "installed history --agent",
  );
  if (
    historyResult.status !== 0 ||
    historyPayload.success !== true ||
    !Array.isArray(historyPayload.events) ||
    !historyPayload.events.some(
      (event) =>
        event?.type === "ragequit"
        && event?.poolAccountId === depositPayload.poolAccountId,
    )
  ) {
    fail(
      `Installed CLI failed history parity after ragequit against shared Anvil:\n${formatResultDiagnostics(historyResult)}`,
    );
  }

  await resetSharedFixture(sharedEnv);

  const jsFallbackHomeDir = join(installRoot, ".privacy-pools-js-fallback");
  mkdirSync(jsFallbackHomeDir, { recursive: true });

  const jsFallbackMnemonicFile = writeInstallSecretFile(
    jsFallbackHomeDir,
    "install-anvil-mnemonic.txt",
    TEST_MNEMONIC,
  );
  const jsFallbackInitResult = runInstalledCli(
    installRoot,
    jsFallbackHomeDir,
    [
      "--agent",
      "init",
      "--recovery-phrase-file",
      jsFallbackMnemonicFile,
      "--private-key-stdin",
      "--default-chain",
      "sepolia",
      "--yes",
    ],
    {
      input: `${TEST_PRIVATE_KEY}\n`,
      timeout: 60_000,
    },
  );
  const jsFallbackInitPayload = parseJson(
    jsFallbackInitResult.stdout,
    "installed js-fallback init --agent",
    [TEST_MNEMONIC, TEST_PRIVATE_KEY],
  );
  if (
    jsFallbackInitResult.status !== 0 ||
    jsFallbackInitPayload.success !== true ||
    jsFallbackInitPayload.defaultChain !== "sepolia"
  ) {
    fail(
      `Installed CLI failed JS-fallback init parity:\n${formatResultDiagnostics(jsFallbackInitResult, [TEST_MNEMONIC, TEST_PRIVATE_KEY])}`,
    );
  }

  const jsFallbackDepositResult = runInstalledCli(
    installRoot,
    jsFallbackHomeDir,
    ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
    {
      env: jsFallbackAnvilEnv,
    },
  );
  const jsFallbackDepositPayload = parseJson(
    jsFallbackDepositResult.stdout,
    "installed js-fallback deposit --agent",
  );
  if (
    jsFallbackDepositResult.status !== 0 ||
    jsFallbackDepositPayload.success !== true ||
    jsFallbackDepositPayload.operation !== "deposit" ||
    typeof jsFallbackDepositPayload.poolAccountId !== "string"
  ) {
    fail(
      `Installed CLI failed JS-fallback deposit parity against shared Anvil:\n${formatResultDiagnostics(jsFallbackDepositResult)}`,
    );
  }

  const jsFallbackDepositEvent = await decodeEthDepositEvent(
    sharedEnv,
    anvilClient,
    jsFallbackDepositPayload.txHash,
  );
  appendInsertedEthLeaf(sharedEnv, jsFallbackDepositEvent.commitment);
  await approveEthLabel(sharedEnv, anvilClient, jsFallbackDepositEvent.label);

  const {
    result: jsFallbackWithdrawResult,
    payload: jsFallbackWithdrawPayload,
  } = await runInstalledRelayedWithdrawWithCatchup({
    installRoot,
    homeDir: jsFallbackHomeDir,
    args: [
      "--agent",
      "withdraw",
      "--all",
      "ETH",
      "--to",
      RELAYED_RECIPIENT,
      "--pool-account",
      jsFallbackDepositPayload.poolAccountId,
      "--chain",
      "sepolia",
    ],
    env: jsFallbackAnvilEnv,
    stage: "js fallback",
  });
  if (
    jsFallbackWithdrawResult.status !== 0 ||
    jsFallbackWithdrawPayload.success !== true ||
    jsFallbackWithdrawPayload.operation !== "withdraw" ||
    jsFallbackWithdrawPayload.mode !== "relayed" ||
    jsFallbackWithdrawPayload.remainingBalance !== "0"
  ) {
    fail(
      `Installed CLI failed JS-fallback relayed withdraw parity against shared Anvil:\n${formatResultDiagnostics(jsFallbackWithdrawResult)}`,
    );
  }

  process.stdout.write(
    `Verified installed CLI and native tarballs against shared Anvil using ${cliTarball ?? requestedCliTarball}\n`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
