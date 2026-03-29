import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
export const DEFAULT_FIXTURE_ROOT = resolve(
  repoRoot,
  "test",
  "fixtures",
  "anvil-contract-artifacts",
);

export const REQUIRED_UPSTREAM_ARTIFACTS = [
  {
    source: "out/WithdrawalVerifier.sol/WithdrawalVerifier.json",
    destination: "out/WithdrawalVerifier.sol/WithdrawalVerifier.json",
  },
  {
    source: "out/CommitmentVerifier.sol/CommitmentVerifier.json",
    destination: "out/CommitmentVerifier.sol/CommitmentVerifier.json",
  },
  {
    source: "out/Entrypoint.sol/Entrypoint.json",
    destination: "out/Entrypoint.sol/Entrypoint.json",
  },
  {
    source: "out/PoseidonT3.sol/PoseidonT3.json",
    destination: "out/PoseidonT3.sol/PoseidonT3.json",
  },
  {
    source: "out/PoseidonT4.sol/PoseidonT4.json",
    destination: "out/PoseidonT4.sol/PoseidonT4.json",
  },
  {
    source: "out/PrivacyPoolSimple.sol/PrivacyPoolSimple.json",
    destination: "out/PrivacyPoolSimple.sol/PrivacyPoolSimple.json",
  },
  {
    source: "out/PrivacyPoolComplex.sol/PrivacyPoolComplex.json",
    destination: "out/PrivacyPoolComplex.sol/PrivacyPoolComplex.json",
  },
  {
    source: "node_modules/@openzeppelin/contracts/build/contracts/ERC1967Proxy.json",
    destination: "vendor/ERC1967Proxy.json",
  },
];

export const TEST_TOKEN_ARTIFACT_DESTINATION =
  "out/MintableUsdToken.sol/MintableUsdToken.json";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.split("=", 2);
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function readJsonFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing at ${path}`);
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label} at ${path}: ${reason}`);
  }
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function buildMintableUsdTokenArtifact({
  forgeCommand = process.platform === "win32" ? "forge.exe" : "forge",
} = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "pp-anvil-token-"));
  const outDir = join(projectRoot, "out");
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

  const result = spawnSync(
    forgeCommand,
    ["build", "--root", projectRoot, "--out", outDir],
    {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  try {
    if (result.error) {
      throw new Error(result.error.message);
    }
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "forge build failed");
    }

    return readJsonFile(
      join(outDir, "MintableUsdToken.sol", "MintableUsdToken.json"),
      "MintableUsdToken artifact",
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

export function refreshAnvilContractFixture({
  contractsRoot,
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
  buildMintableUsdTokenArtifactImpl = buildMintableUsdTokenArtifact,
}) {
  const resolvedContractsRoot = resolve(contractsRoot);
  const resolvedFixtureRoot = resolve(fixtureRoot);

  for (const artifact of REQUIRED_UPSTREAM_ARTIFACTS) {
    const sourcePath = join(resolvedContractsRoot, artifact.source);
    const destinationPath = join(resolvedFixtureRoot, artifact.destination);
    writeJsonFile(
      destinationPath,
      readJsonFile(sourcePath, artifact.source),
    );
  }

  writeJsonFile(
    join(resolvedFixtureRoot, TEST_TOKEN_ARTIFACT_DESTINATION),
    buildMintableUsdTokenArtifactImpl(),
  );
}

const isDirectRun = (() => {
  const argvEntry = process.argv[1]?.trim();
  if (!argvEntry) return false;
  return resolve(argvEntry) === resolve(fileURLToPath(import.meta.url));
})();

if (isDirectRun) {
  const args = parseArgs(process.argv.slice(2));
  const contractsRoot = args["contracts-root"]?.trim();
  const fixtureRoot = args["fixture-root"]?.trim();

  if (!contractsRoot) {
    fail(
      "Usage: node scripts/refresh-anvil-contract-fixture.mjs --contracts-root <privacy-pools-core/contracts path> [--fixture-root <path>]",
    );
  }

  try {
    refreshAnvilContractFixture({
      contractsRoot,
      fixtureRoot: fixtureRoot || DEFAULT_FIXTURE_ROOT,
    });
    process.stdout.write(
      `refreshed anvil contract fixture in ${resolve(fixtureRoot || DEFAULT_FIXTURE_ROOT)} from ${resolve(contractsRoot)}\n`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(reason);
  }
}
