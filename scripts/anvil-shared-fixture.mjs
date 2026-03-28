import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONTRACTS_ROOT = process.env.PP_CONTRACTS_ROOT
  ? resolve(process.env.PP_CONTRACTS_ROOT)
  : resolve(
      ROOT,
      "..",
      "..",
      "docs",
      "privacy-pools-core-main",
      "packages",
      "contracts",
    );
const ASP_SERVER_SCRIPT = resolve(ROOT, "test", "helpers", "anvil-asp-server.ts");
const RELAYER_SERVER_SCRIPT = resolve(
  ROOT,
  "test",
  "helpers",
  "anvil-relayer-server.ts",
);
const NODE_EXECUTABLE = process.platform === "win32" ? "node.exe" : "node";
const CREATE2_FACTORY_ADDRESS = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";
const POSTMAN_ADDRESS = "0x696fe46495688fc9e99bad2daf2133b33de364ea";
const SIGNER_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const RELAYER_PRIVATE_KEY =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const DEPLOYER_PRIVATE_KEY =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FEE_RECEIVER_ADDRESS = "0x3333333333333333333333333333333333333333";
const INITIAL_ROOT = 1n;
const INITIAL_ROOT_CID =
  "bafybeigdyrzt5sharedanvilinitialroot12345678901234567890";
const LOCAL_TEST_CHAIN = { ...sepolia, id: 11155111 };
const ERC20_SYMBOL = "USDC";
const ERC20_DECIMALS = 6;
const CONTRACTS_ARTIFACT_SENTINEL = resolve(
  CONTRACTS_ROOT,
  "out",
  "Entrypoint.sol",
  "Entrypoint.json",
);
const CONTRACTS_PROXY_ARTIFACT = resolve(
  CONTRACTS_ROOT,
  "node_modules",
  "@openzeppelin",
  "contracts",
  "build",
  "contracts",
  "ERC1967Proxy.json",
);
const CONTRACTS_WORKSPACE_NODE_MODULES = resolve(
  CONTRACTS_ROOT,
  "..",
  "..",
  "node_modules",
);
const LEAN_IMT_SOURCE = resolve(
  CONTRACTS_WORKSPACE_NODE_MODULES,
  "@zk-kit",
  "lean-imt.sol",
);
const LEAN_IMT_ALIAS = resolve(CONTRACTS_WORKSPACE_NODE_MODULES, "lean-imt");

const entrypointAbi = parseAbi([
  "function initialize(address _owner, address _postman)",
  "function registerPool(address _asset, address _pool, uint256 _minimumDepositAmount, uint256 _vettingFeeBPS, uint256 _maxRelayFeeBPS)",
  "function updateRoot(uint256 _root, string _ipfsCID) returns (uint256 _index)",
]);

const poolAbi = parseAbi([
  "function SCOPE() view returns (uint256)",
]);

function normalizeBytecode(bytecode) {
  const raw = typeof bytecode === "string" ? bytecode : bytecode?.object;
  if (!raw) {
    throw new Error("Artifact bytecode is missing");
  }
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function linkArtifactBytecode(artifact, libraries) {
  const linkReferences =
    artifact.linkReferences ?? artifact.bytecode?.linkReferences ?? {};
  let linkedBytecode = normalizeBytecode(artifact.bytecode);

  for (const fileReferences of Object.values(linkReferences)) {
    for (const [libraryName, references] of Object.entries(fileReferences)) {
      const address = libraries[libraryName];
      if (!address) {
        throw new Error(`Missing linked library address for ${libraryName}`);
      }
      const addressHex = address.toLowerCase().replace(/^0x/, "");
      for (const reference of references) {
        const start = 2 + reference.start * 2;
        const end = start + reference.length * 2;
        linkedBytecode =
          linkedBytecode.slice(0, start)
          + addressHex
          + linkedBytecode.slice(end);
      }
    }
  }

  return linkedBytecode;
}

function readArtifact(relativePath) {
  return JSON.parse(
    readFileSync(resolve(CONTRACTS_ROOT, relativePath), "utf8"),
  );
}

function ensureContractsWorkspaceDependencies() {
  if (
    existsSync(LEAN_IMT_SOURCE)
    && existsSync(CONTRACTS_PROXY_ARTIFACT)
  ) {
    return;
  }

  const result = spawnSync(
    "bash",
    [
      "-lc",
      "corepack enable >/dev/null 2>&1 || true; yarn --frozen-lockfile --network-concurrency 1",
    ],
    {
      cwd: CONTRACTS_ROOT,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || "failed to install contracts workspace dependencies",
    );
  }
}

function normalizeContractsRemappings() {
  const remappingsPath = resolve(CONTRACTS_ROOT, "remappings.txt");
  if (!existsSync(remappingsPath)) {
    return;
  }

  const current = readFileSync(remappingsPath, "utf8");
  const updated = current
    .split("\n")
    .map((line) => (
      line.startsWith("lean-imt/=")
        ? "lean-imt/=../../node_modules/lean-imt/"
        : line
    ))
    .join("\n");

  if (updated !== current) {
    writeFileSync(remappingsPath, updated, "utf8");
  }
}

function ensureLeanImtAlias() {
  if (!existsSync(LEAN_IMT_SOURCE) || existsSync(LEAN_IMT_ALIAS)) {
    return;
  }

  symlinkSync(LEAN_IMT_SOURCE, LEAN_IMT_ALIAS, "dir");
}

function ensureContractsArtifacts() {
  ensureContractsWorkspaceDependencies();
  ensureLeanImtAlias();
  normalizeContractsRemappings();

  if (existsSync(CONTRACTS_ARTIFACT_SENTINEL) && existsSync(CONTRACTS_PROXY_ARTIFACT)) {
    return;
  }

  const result = spawnSync("forge", ["build"], {
    cwd: CONTRACTS_ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "forge build failed");
  }
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
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
        else resolvePort(port);
      });
    });
  });
}

async function rpc(rpcUrl, method, params = []) {
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

async function waitForRpc(rpcUrl) {
  const deadline = Date.now() + 20_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await rpc(rpcUrl, "eth_chainId");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
    }
  }

  throw lastError ?? new Error("Timed out waiting for Anvil RPC");
}

async function launchAnvil(baseEnv = process.env) {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const proc = spawn("anvil", [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--chain-id",
    String(LOCAL_TEST_CHAIN.id),
    "--silent",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    env: baseEnv,
  });

  let recentStderr = "";
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk) => {
    recentStderr = (recentStderr + chunk).slice(-2_000);
  });

  try {
    await waitForRpc(url);
  } catch (error) {
    proc.kill();
    throw new Error(
      `Failed to launch Anvil: ${
        error instanceof Error ? error.message : String(error)
      }${recentStderr ? ` stderr: ${recentStderr.trim()}` : ""}`,
    );
  }

  proc.stderr?.removeAllListeners("data");
  proc.stderr?.destroy();
  proc.unref();

  return { proc, url };
}

async function terminateChild(proc) {
  if (proc.killed || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await new Promise((resolveWait) => {
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      resolveWait();
    }, 5_000);
    proc.once("exit", () => {
      clearTimeout(timeout);
      resolveWait();
    });
  });
}

function compileMintableUsdToken(outDir) {
  const projectRoot = mkdtempSync(join(tmpdir(), "pp-anvil-token-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    join(projectRoot, "foundry.toml"),
    [
      "[profile.default]",
      "src = 'src'",
      "out = 'out'",
      "solc_version = '0.8.28'",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(projectRoot, "src", "MintableUsdToken.sol"),
    `// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

contract MintableUsdToken {
  string public constant name = "USD Coin";
  string public constant symbol = "USDC";
  uint8 public constant decimals = 6;
  uint256 public totalSupply;

  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);

  function mint(address to, uint256 amount) external returns (bool) {
    totalSupply += amount;
    balanceOf[to] += amount;
    emit Transfer(address(0), to, amount);
    return true;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _transfer(msg.sender, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 currentAllowance = allowance[from][msg.sender];
    require(currentAllowance >= amount, "ERC20: insufficient allowance");
    unchecked {
      allowance[from][msg.sender] = currentAllowance - amount;
    }
    emit Approval(from, msg.sender, allowance[from][msg.sender]);
    _transfer(from, to, amount);
    return true;
  }

  function _transfer(address from, address to, uint256 amount) internal {
    require(balanceOf[from] >= amount, "ERC20: insufficient balance");
    unchecked {
      balanceOf[from] -= amount;
    }
    balanceOf[to] += amount;
    emit Transfer(from, to, amount);
  }
}
`,
    "utf8",
  );

  const result = spawnSync("forge", ["build", "--root", projectRoot, "--out", outDir], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const artifactPath = join(outDir, "MintableUsdToken.sol", "MintableUsdToken.json");

  try {
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "forge build failed");
    }
    return JSON.parse(readFileSync(artifactPath, "utf8"));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

async function deployProtocol(rpcUrl) {
  ensureContractsArtifacts();

  const deployer = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
  const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const signer = privateKeyToAccount(SIGNER_PRIVATE_KEY);
  const publicClient = createPublicClient({
    chain: LOCAL_TEST_CHAIN,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account: deployer,
    chain: LOCAL_TEST_CHAIN,
    transport: http(rpcUrl),
  });

  for (const address of [
    deployer.address,
    relayer.address,
    signer.address,
    POSTMAN_ADDRESS,
    FEE_RECEIVER_ADDRESS,
    CREATE2_FACTORY_ADDRESS,
  ]) {
    await rpc(rpcUrl, "anvil_setBalance", [address, `0x${(10n ** 21n).toString(16)}`]);
  }

  const withdrawalVerifierArtifact = readArtifact("out/WithdrawalVerifier.sol/WithdrawalVerifier.json");
  const commitmentVerifierArtifact = readArtifact("out/CommitmentVerifier.sol/CommitmentVerifier.json");
  const entrypointArtifact = readArtifact("out/Entrypoint.sol/Entrypoint.json");
  const poseidonT3Artifact = readArtifact("out/PoseidonT3.sol/PoseidonT3.json");
  const poseidonT4Artifact = readArtifact("out/PoseidonT4.sol/PoseidonT4.json");
  const proxyArtifact = JSON.parse(
    readFileSync(
      resolve(
        CONTRACTS_ROOT,
        "node_modules",
        "@openzeppelin",
        "contracts",
        "build",
        "contracts",
        "ERC1967Proxy.json",
      ),
      "utf8",
    ),
  );
  const simplePoolArtifact = readArtifact("out/PrivacyPoolSimple.sol/PrivacyPoolSimple.json");
  const complexPoolArtifact = readArtifact("out/PrivacyPoolComplex.sol/PrivacyPoolComplex.json");
  const tokenArtifact = compileMintableUsdToken(join(tmpdir(), "pp-anvil-token-artifacts"));

  const withdrawalVerifierHash = await walletClient.deployContract({
    abi: withdrawalVerifierArtifact.abi,
    bytecode: normalizeBytecode(withdrawalVerifierArtifact.bytecode),
    args: [],
  });
  const withdrawalVerifierReceipt = await publicClient.waitForTransactionReceipt({
    hash: withdrawalVerifierHash,
  });
  const withdrawalVerifier = withdrawalVerifierReceipt.contractAddress;

  const commitmentVerifierHash = await walletClient.deployContract({
    abi: commitmentVerifierArtifact.abi,
    bytecode: normalizeBytecode(commitmentVerifierArtifact.bytecode),
    args: [],
  });
  const commitmentVerifierReceipt = await publicClient.waitForTransactionReceipt({
    hash: commitmentVerifierHash,
  });
  const commitmentVerifier = commitmentVerifierReceipt.contractAddress;

  const entrypointImplHash = await walletClient.deployContract({
    abi: entrypointArtifact.abi,
    bytecode: normalizeBytecode(entrypointArtifact.bytecode),
    args: [],
  });
  const entrypointImplReceipt = await publicClient.waitForTransactionReceipt({
    hash: entrypointImplHash,
  });
  const entrypointImplementation = entrypointImplReceipt.contractAddress;

  const initializeData = encodeFunctionData({
    abi: entrypointArtifact.abi,
    functionName: "initialize",
    args: [deployer.address, POSTMAN_ADDRESS],
  });

  const proxyHash = await walletClient.deployContract({
    abi: proxyArtifact.abi,
    bytecode: normalizeBytecode(proxyArtifact.bytecode),
    args: [entrypointImplementation, initializeData],
  });
  const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash });
  const entrypoint = proxyReceipt.contractAddress;

  const poseidonT3Hash = await walletClient.deployContract({
    abi: poseidonT3Artifact.abi,
    bytecode: normalizeBytecode(poseidonT3Artifact.bytecode),
    args: [],
  });
  const poseidonT3Receipt = await publicClient.waitForTransactionReceipt({
    hash: poseidonT3Hash,
  });
  const poseidonT3 = poseidonT3Receipt.contractAddress;

  const poseidonT4Hash = await walletClient.deployContract({
    abi: poseidonT4Artifact.abi,
    bytecode: normalizeBytecode(poseidonT4Artifact.bytecode),
    args: [],
  });
  const poseidonT4Receipt = await publicClient.waitForTransactionReceipt({
    hash: poseidonT4Hash,
  });
  const poseidonT4 = poseidonT4Receipt.contractAddress;

  const ethPoolHash = await walletClient.deployContract({
    abi: simplePoolArtifact.abi,
    bytecode: linkArtifactBytecode(simplePoolArtifact, {
      PoseidonT3: poseidonT3,
      PoseidonT4: poseidonT4,
    }),
    args: [entrypoint, withdrawalVerifier, commitmentVerifier],
  });
  const ethPoolReceipt = await publicClient.waitForTransactionReceipt({ hash: ethPoolHash });
  const ethPool = ethPoolReceipt.contractAddress;

  const tokenHash = await walletClient.deployContract({
    abi: tokenArtifact.abi,
    bytecode: normalizeBytecode(tokenArtifact.bytecode),
    args: [],
  });
  const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash });
  const tokenAddress = tokenReceipt.contractAddress;

  const erc20PoolHash = await walletClient.deployContract({
    abi: complexPoolArtifact.abi,
    bytecode: linkArtifactBytecode(complexPoolArtifact, {
      PoseidonT3: poseidonT3,
      PoseidonT4: poseidonT4,
    }),
    args: [entrypoint, withdrawalVerifier, commitmentVerifier, tokenAddress],
  });
  const erc20PoolReceipt = await publicClient.waitForTransactionReceipt({
    hash: erc20PoolHash,
  });
  const erc20Pool = erc20PoolReceipt.contractAddress;

  const minimumEthDeposit = 10n ** 15n;
  const minimumErc20Deposit = 10n ** BigInt(ERC20_DECIMALS);

  const registerEthHash = await walletClient.writeContract({
    address: entrypoint,
    abi: entrypointAbi,
    functionName: "registerPool",
    args: [
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      ethPool,
      minimumEthDeposit,
      100n,
      100n,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: registerEthHash });

  const registerErc20Hash = await walletClient.writeContract({
    address: entrypoint,
    abi: entrypointAbi,
    functionName: "registerPool",
    args: [tokenAddress, erc20Pool, minimumErc20Deposit, 100n, 100n],
  });
  await publicClient.waitForTransactionReceipt({ hash: registerErc20Hash });

  const [ethScope, erc20Scope] = await Promise.all([
    publicClient.readContract({
      address: ethPool,
      abi: poolAbi,
      functionName: "SCOPE",
    }),
    publicClient.readContract({
      address: erc20Pool,
      abi: poolAbi,
      functionName: "SCOPE",
    }),
  ]);

  return {
    entrypoint,
    signer,
    relayer,
    ethPool: {
      poolAddress: ethPool,
      scope: ethScope.toString(),
      assetAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      symbol: "ETH",
      decimals: 18,
      minimumDepositAmount: minimumEthDeposit.toString(),
      vettingFeeBPS: "100",
      maxRelayFeeBPS: "100",
    },
    erc20Pool: {
      poolAddress: erc20Pool,
      scope: erc20Scope.toString(),
      assetAddress: tokenAddress,
      symbol: ERC20_SYMBOL,
      decimals: ERC20_DECIMALS,
      minimumDepositAmount: minimumErc20Deposit.toString(),
      vettingFeeBPS: "100",
      maxRelayFeeBPS: "100",
    },
  };
}

async function seedInitialAspRoot(rpcUrl, entrypoint) {
  await rpc(rpcUrl, "anvil_impersonateAccount", [POSTMAN_ADDRESS]);
  await rpc(rpcUrl, "anvil_setBalance", [
    POSTMAN_ADDRESS,
    `0x${(10n ** 20n).toString(16)}`,
  ]);

  try {
    const publicClient = createPublicClient({
      chain: LOCAL_TEST_CHAIN,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account: POSTMAN_ADDRESS,
      chain: LOCAL_TEST_CHAIN,
      transport: http(rpcUrl),
    });

    const txHash = await walletClient.writeContract({
      address: entrypoint,
      abi: entrypointAbi,
      functionName: "updateRoot",
      args: [INITIAL_ROOT, INITIAL_ROOT_CID],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`Initial updateRoot reverted: ${txHash}`);
    }
  } finally {
    await rpc(rpcUrl, "anvil_stopImpersonatingAccount", [POSTMAN_ADDRESS]);
  }
}

function waitForServerPort(proc, pattern, label) {
  return new Promise((resolveServer, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`${label} did not start within 10s`));
    }, 10_000);

    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(pattern);
      if (!match) return;
      clearTimeout(timeout);
      proc.stdout.removeAllListeners("data");
      proc.stdout.destroy();
      proc.unref();
      resolveServer(Number(match[1]));
    });

    proc.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`${label} exited early with code ${code}`));
    });
  });
}

function launchTsxServer(scriptPath, env, label, baseEnv = process.env) {
  const proc = spawn(NODE_EXECUTABLE, ["--import", "tsx", scriptPath], {
    cwd: ROOT,
    env: {
      ...baseEnv,
      ...env,
    },
    stdio: ["ignore", "pipe", "ignore"],
  });

  return waitForServerPort(
    proc,
    label === "asp" ? /ANVIL_ASP_PORT=(\d+)/ : /ANVIL_RELAYER_PORT=(\d+)/,
    label,
  ).then((port) => ({
    proc,
    port,
    url: `http://127.0.0.1:${port}`,
  }));
}

export async function setupSharedAnvilFixture(options = {}) {
  const baseEnv = options.baseEnv ?? process.env;
  const stateRoot = mkdtempSync(join(tmpdir(), "pp-anvil-shared-"));
  const sharedCircuitsDir = baseEnv.PP_ANVIL_SHARED_CIRCUITS_DIR?.trim()
    || mkdtempSync(join(tmpdir(), "pp-anvil-circuits-"));
  const aspStateFile = join(stateRoot, "asp-state.json");
  const resetStateFile = join(stateRoot, "reset-state.json");
  const envFile = join(stateRoot, "env.json");

  const anvil = await launchAnvil(baseEnv);
  let aspServer = null;
  let relayerServer = null;

  try {
    const deployment = await deployProtocol(anvil.url);
    await seedInitialAspRoot(anvil.url, deployment.entrypoint);
    const baselineAspState = {
      chainId: LOCAL_TEST_CHAIN.id,
      rpcUrl: anvil.url,
      entrypoint: deployment.entrypoint,
      pools: [
        {
          scope: deployment.ethPool.scope,
          poolAddress: deployment.ethPool.poolAddress,
          assetAddress: deployment.ethPool.assetAddress,
          symbol: deployment.ethPool.symbol,
          decimals: deployment.ethPool.decimals,
          baseStateTreeLeaves: [],
          insertedStateTreeLeaves: [],
          approvedLabels: [],
          reviewStatuses: {},
        },
        {
          scope: deployment.erc20Pool.scope,
          poolAddress: deployment.erc20Pool.poolAddress,
          assetAddress: deployment.erc20Pool.assetAddress,
          symbol: deployment.erc20Pool.symbol,
          decimals: deployment.erc20Pool.decimals,
          baseStateTreeLeaves: [],
          insertedStateTreeLeaves: [],
          approvedLabels: [],
          reviewStatuses: {},
        },
      ],
    };
    writeFileSync(aspStateFile, JSON.stringify(baselineAspState, null, 2), "utf8");

    aspServer = await launchTsxServer(
      ASP_SERVER_SCRIPT,
      { PP_ANVIL_ASP_STATE_FILE: aspStateFile },
      "asp",
      baseEnv,
    );
    relayerServer = await launchTsxServer(
      RELAYER_SERVER_SCRIPT,
      {
        PP_ANVIL_RELAYER_CONFIG: JSON.stringify({
          chainId: LOCAL_TEST_CHAIN.id,
          rpcUrl: anvil.url,
          entrypoint: deployment.entrypoint,
          relayerPrivateKey: RELAYER_PRIVATE_KEY,
          assets: [
            {
              assetAddress: deployment.ethPool.assetAddress,
              feeReceiverAddress: FEE_RECEIVER_ADDRESS,
              feeBPS: deployment.ethPool.maxRelayFeeBPS,
              minWithdrawAmount: deployment.ethPool.minimumDepositAmount,
              maxGasPrice: "100000000000",
            },
            {
              assetAddress: deployment.erc20Pool.assetAddress,
              feeReceiverAddress: FEE_RECEIVER_ADDRESS,
              feeBPS: deployment.erc20Pool.maxRelayFeeBPS,
              minWithdrawAmount: deployment.erc20Pool.minimumDepositAmount,
              maxGasPrice: "100000000000",
            },
          ],
        }),
      },
      "relayer",
      baseEnv,
    );

    const initialSnapshotId = await rpc(anvil.url, "evm_snapshot");
    writeFileSync(
      resetStateFile,
      JSON.stringify({
        currentSnapshotId: initialSnapshotId,
        baselineAspState,
        aspStateFile,
        relayerUrl: relayerServer.url,
      }, null, 2),
      "utf8",
    );

    writeFileSync(
      envFile,
      JSON.stringify({
        chainName: "sepolia",
        chainId: LOCAL_TEST_CHAIN.id,
        rpcUrl: anvil.url,
        aspUrl: aspServer.url,
        relayerUrl: relayerServer.url,
        circuitsDir: sharedCircuitsDir,
        entrypoint: deployment.entrypoint,
        startBlock: 0,
        postmanAddress: POSTMAN_ADDRESS,
        signerPrivateKey: SIGNER_PRIVATE_KEY,
        relayerPrivateKey: RELAYER_PRIVATE_KEY,
        resetStateFile,
        aspStateFile,
        pools: {
          eth: deployment.ethPool,
          erc20: deployment.erc20Pool,
        },
      }, null, 2),
      "utf8",
    );

    return {
      envFile,
      sharedCircuitsDir,
      cleanup: async () => {
        await Promise.allSettled([
          relayerServer ? terminateChild(relayerServer.proc) : Promise.resolve(),
          aspServer ? terminateChild(aspServer.proc) : Promise.resolve(),
          terminateChild(anvil.proc),
        ]);
        rmSync(stateRoot, { recursive: true, force: true });
        if (!baseEnv.PP_ANVIL_SHARED_CIRCUITS_DIR) {
          rmSync(sharedCircuitsDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await Promise.allSettled([
      relayerServer ? terminateChild(relayerServer.proc) : Promise.resolve(),
      aspServer ? terminateChild(aspServer.proc) : Promise.resolve(),
      terminateChild(anvil.proc),
    ]);
    rmSync(stateRoot, { recursive: true, force: true });
    if (!baseEnv.PP_ANVIL_SHARED_CIRCUITS_DIR) {
      rmSync(sharedCircuitsDir, { recursive: true, force: true });
    }
    throw error;
  }
}
