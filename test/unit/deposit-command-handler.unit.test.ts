import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Command } from "commander";
import { CHAINS } from "../../src/config/chains.ts";
import {
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";
import { expectUnsignedTransactions } from "../helpers/unsigned-assertions.ts";

const realAccount = captureModuleExports(
  await import("../../src/services/account.ts"),
);
const realContracts = captureModuleExports(
  await import("../../src/services/contracts.ts"),
);
const realInquirerPrompts = captureModuleExports(
  await import("@inquirer/prompts"),
);
const realPoolAccounts = captureModuleExports(
  await import("../../src/utils/pool-accounts.ts"),
);
const realPools = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const realPreflight = captureModuleExports(
  await import("../../src/utils/preflight.ts"),
);
const realLock = captureModuleExports(await import("../../src/utils/lock.ts"));
const realCriticalSection = captureModuleExports(
  await import("../../src/utils/critical-section.ts"),
);
const realViem = captureModuleExports(await import("viem"));

const DEPOSIT_HANDLER_MODULE_RESTORES = [
  ["@inquirer/prompts", realInquirerPrompts],
  ["../../src/services/account.ts", realAccount],
  ["../../src/services/sdk.ts", realSdk],
  ["../../src/services/pools.ts", realPools],
  ["../../src/utils/preflight.ts", realPreflight],
  ["../../src/services/contracts.ts", realContracts],
  ["../../src/utils/pool-accounts.ts", realPoolAccounts],
  ["../../src/utils/lock.ts", realLock],
  ["../../src/utils/critical-section.ts", realCriticalSection],
  ["viem", realViem],
] as const;

const ETH_POOL = {
  symbol: "ETH",
  pool: "0x1111111111111111111111111111111111111111",
  asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  scope: 1n,
  decimals: 18,
  deploymentBlock: 1n,
  minimumDepositAmount: 10000000000000000n,
  vettingFeeBPS: 100n,
  totalDepositsValue: 0n,
  acceptedDepositsValue: 0n,
  pendingDepositsValue: 0n,
  totalInPoolValue: 0n,
};

const USDC_POOL = {
  ...ETH_POOL,
  symbol: "USDC",
  asset: "0x2222222222222222222222222222222222222222",
  scope: 2n,
  decimals: 6,
  minimumDepositAmount: 1_000_000n,
};

const initializeAccountServiceMock = mock(async () => ({
  account: { poolAccounts: new Map() },
  createDepositSecrets: () => ({
    precommitment: 777n,
    nullifier: 888n,
    secret: 999n,
  }),
  addPoolAccount: mock(() => undefined),
}));
const saveAccountMock = mock(() => undefined);
const saveSyncMetaMock = mock(() => undefined);
const withSuppressedSdkStdoutSyncMock = mock(<T>(fn: () => T): T => fn());
const getDataServiceMock = mock(async () => ({}));
const getPublicClientMock = mock(() => ({
  waitForTransactionReceipt: async () => ({
    status: "success",
    blockNumber: 222n,
    logs: [
      {
        address: ETH_POOL.pool,
        data: "0x",
        topics: [],
      },
    ],
  }),
}));
const resolvePoolMock = mock(async () => ETH_POOL);
const listPoolsMock = mock(async () => [ETH_POOL, USDC_POOL]);
const checkNativeBalanceMock = mock(async () => undefined);
const checkErc20BalanceMock = mock(async () => undefined);
const checkHasGasMock = mock(async () => undefined);
const approveERC20Mock = mock(async () => ({
  hash: "0x" + "12".repeat(32),
}));
const depositETHMock = mock(async () => ({
  hash: "0x" + "34".repeat(32),
}));
const depositERC20Mock = mock(async () => ({
  hash: "0x" + "56".repeat(32),
}));
const acquireProcessLockMock = mock(() => () => undefined);
const guardCriticalSectionMock = mock(() => undefined);
const releaseCriticalSectionMock = mock(() => undefined);
const decodeEventLogMock = mock(() => ({
  args: {
    _label: 444n,
    _value: 99000000000000000n,
  },
}));
const confirmPromptMock = mock(async () => true);
const selectPromptMock = mock(async () => "ETH");

let handleDepositCommand: typeof import("../../src/commands/deposit.ts").handleDepositCommand;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function useIsolatedHome(options: {
  defaultChain?: string;
  withSigner?: boolean;
} = {}): string {
  const home = createTrackedTempDir("pp-deposit-handler-");
  process.env.PRIVACY_POOLS_HOME = home;
  saveConfig({
    defaultChain: options.defaultChain ?? "mainnet",
    rpcOverrides: {},
  });
  saveMnemonicToFile(
    "test test test test test test test test test test test junk",
  );
  if (options.withSigner) {
    saveSignerKey("0x" + "11".repeat(32));
  }
  return home;
}

async function loadDepositCommandHandler(): Promise<void> {
  mock.module("@inquirer/prompts", () => ({
    ...realInquirerPrompts,
    confirm: confirmPromptMock,
    select: selectPromptMock,
  }));
  mock.module("../../src/services/account.ts", () => ({
    ...realAccount,
    initializeAccountService: initializeAccountServiceMock,
    saveAccount: saveAccountMock,
    saveSyncMeta: saveSyncMetaMock,
    withSuppressedSdkStdoutSync: withSuppressedSdkStdoutSyncMock,
  }));
  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdk,
    getDataService: getDataServiceMock,
    getPublicClient: getPublicClientMock,
  }));
  mock.module("../../src/services/pools.ts", () => ({
    ...realPools,
    resolvePool: resolvePoolMock,
    listPools: listPoolsMock,
  }));
  mock.module("../../src/utils/preflight.ts", () => ({
    checkNativeBalance: checkNativeBalanceMock,
    checkErc20Balance: checkErc20BalanceMock,
    checkHasGas: checkHasGasMock,
  }));
  mock.module("../../src/services/contracts.ts", () => ({
    ...realContracts,
    approveERC20: approveERC20Mock,
    depositETH: depositETHMock,
    depositERC20: depositERC20Mock,
  }));
  mock.module("../../src/utils/pool-accounts.ts", () => ({
    ...realPoolAccounts,
  }));
  mock.module("../../src/utils/lock.ts", () => ({
    acquireProcessLock: acquireProcessLockMock,
  }));
  mock.module("../../src/utils/critical-section.ts", () => ({
    guardCriticalSection: guardCriticalSectionMock,
    releaseCriticalSection: releaseCriticalSectionMock,
  }));
  mock.module("viem", () => ({
    ...realViem,
    decodeEventLog: decodeEventLogMock,
  }));

  ({ handleDepositCommand } = await import(
    "../../src/commands/deposit.ts"
  ));
}

afterEach(() => {
  restoreModuleImplementations(DEPOSIT_HANDLER_MODULE_RESTORES);
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  cleanupTrackedTempDirs();
});

beforeEach(() => {
  mock.restore();
  saveAccountMock.mockClear();
  saveSyncMetaMock.mockClear();
  getDataServiceMock.mockClear();
  approveERC20Mock.mockClear();
  depositETHMock.mockClear();
  depositERC20Mock.mockClear();
  checkNativeBalanceMock.mockClear();
  checkErc20BalanceMock.mockClear();
  checkHasGasMock.mockClear();
  acquireProcessLockMock.mockClear();
  guardCriticalSectionMock.mockClear();
  releaseCriticalSectionMock.mockClear();
  confirmPromptMock.mockClear();
  selectPromptMock.mockClear();
  confirmPromptMock.mockImplementation(async () => true);
  selectPromptMock.mockImplementation(async () => "ETH");
  saveAccountMock.mockImplementation(() => undefined);
  saveSyncMetaMock.mockImplementation(() => undefined);
  getDataServiceMock.mockImplementation(async () => ({}));
  approveERC20Mock.mockImplementation(async () => ({
    hash: "0x" + "12".repeat(32),
  }));
  depositETHMock.mockImplementation(async () => ({
    hash: "0x" + "34".repeat(32),
  }));
  depositERC20Mock.mockImplementation(async () => ({
    hash: "0x" + "56".repeat(32),
  }));
  checkNativeBalanceMock.mockImplementation(async () => undefined);
  checkErc20BalanceMock.mockImplementation(async () => undefined);
  checkHasGasMock.mockImplementation(async () => undefined);
  acquireProcessLockMock.mockImplementation(() => () => undefined);
  guardCriticalSectionMock.mockImplementation(() => undefined);
  releaseCriticalSectionMock.mockImplementation(() => undefined);
  initializeAccountServiceMock.mockImplementation(async () => ({
    account: { poolAccounts: new Map() },
    createDepositSecrets: () => ({
      precommitment: 777n,
      nullifier: 888n,
      secret: 999n,
    }),
    addPoolAccount: mock(() => undefined),
  }));
  resolvePoolMock.mockImplementation(async () => ETH_POOL);
  listPoolsMock.mockImplementation(async () => [ETH_POOL, USDC_POOL]);
  getPublicClientMock.mockImplementation(() => ({
    waitForTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 222n,
      logs: [
        {
          address: ETH_POOL.pool,
          data: "0x",
          topics: [],
        },
      ],
    }),
  }));
  decodeEventLogMock.mockImplementation(() => ({
    args: {
      _label: 444n,
      _value: 99000000000000000n,
    },
  }));
});

beforeEach(async () => {
  await loadDepositCommandHandler();
});

describe("deposit command handler", () => {
  test("fails closed when no asset is provided in machine mode", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDepositCommand(
        "0.25",
        undefined,
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("No asset specified");
    expect(exitCode).toBe(2);
  });

  test("lets humans pick an asset interactively when none is provided", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementation(async () => "USDC");

    const { stderr } = await captureAsyncOutput(() =>
      handleDepositCommand(
        "100",
        undefined,
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(selectPromptMock).toHaveBeenCalled();
    expect(approveERC20Mock).toHaveBeenCalledTimes(1);
    expect(depositERC20Mock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Deposit confirmed");
  });

  test("fails cleanly for humans when no pools are available to choose from", async () => {
    useIsolatedHome({ withSigner: true });
    listPoolsMock.mockImplementation(async () => []);

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleDepositCommand(
        "0.25",
        undefined,
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("No pools found on mainnet");
    expect(depositETHMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  test("renders a JSON dry-run without requiring a signer key", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleDepositCommand(
        "0.25",
        "ETH",
        { dryRun: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.operation).toBe("deposit");
    expect(json.asset).toBe("ETH");
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.balanceSufficient).toBe("unknown");
  });

  test("dry-run reports a positive balance check when a signer key is available", async () => {
    useIsolatedHome({ withSigner: true });

    const { json } = await captureAsyncJsonOutput(() =>
      handleDepositCommand(
        "0.25",
        "ETH",
        { dryRun: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.balanceSufficient).toBe(true);
    expect(checkNativeBalanceMock).toHaveBeenCalledTimes(1);
  });

  test("builds unsigned ERC20 deposit transactions in JSON mode", async () => {
    useIsolatedHome();
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);

    const { json } = await captureAsyncJsonOutput(() =>
      handleDepositCommand(
        "100",
        "USDC",
        { unsigned: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("unsigned");
    expect(json.operation).toBe("deposit");
    expect(json.asset).toBe("USDC");
    expect(json.precommitment).toBe("777");
    expectUnsignedTransactions(json.transactions, [
      {
        chainId: 1,
        from: null,
        to: USDC_POOL.asset,
        value: "0",
        description: "Approve ERC-20 allowance for Entrypoint",
      },
      {
        chainId: 1,
        from: null,
        to: CHAINS.mainnet.entrypoint,
        value: "0",
        description: "Deposit USDC into Privacy Pool",
      },
    ]);
  });

  test("prints raw unsigned transactions when --unsigned tx is requested", async () => {
    useIsolatedHome();
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleDepositCommand(
        "100",
        "USDC",
        { unsigned: "tx" },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    const transactions = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expectUnsignedTransactions(transactions, [
      {
        chainId: 1,
        to: USDC_POOL.asset,
        value: "0",
        description: "Approve ERC-20 allowance for Entrypoint",
      },
      {
        chainId: 1,
        to: CHAINS.mainnet.entrypoint,
        value: "0",
        description: "Deposit USDC into Privacy Pool",
      },
    ]);
    expect(stderr).toBe("");
  });

  test("rejects deposits below the pool minimum before any transaction work", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDepositCommand(
        "0.001",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("below the minimum");
    expect(exitCode).toBe(2);
  });

  test("persists a signed native deposit after onchain confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    const addPoolAccountMock = mock(() => undefined);
    initializeAccountServiceMock.mockImplementationOnce(async () => ({
      account: { poolAccounts: new Map() },
      createDepositSecrets: () => ({
        precommitment: 777n,
        nullifier: 888n,
        secret: 999n,
      }),
      addPoolAccount: addPoolAccountMock,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleDepositCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("deposit");
    expect(json.txHash).toBe("0x" + "34".repeat(32));
    expect(json.committedValue).toBe("99000000000000000");
    expect(addPoolAccountMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).toHaveBeenCalledTimes(1);
    expect(saveSyncMetaMock).toHaveBeenCalledTimes(1);
  });

  test("submits an ERC20 approval and deposit before persisting the Pool Account", async () => {
    useIsolatedHome({ withSigner: true });
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);
    decodeEventLogMock.mockImplementationOnce(() => ({
      args: {
        _label: 445n,
        _value: 99_000_000n,
      },
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleDepositCommand(
        "100",
        "USDC",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.asset).toBe("USDC");
    expect(approveERC20Mock).toHaveBeenCalledTimes(1);
    expect(depositERC20Mock).toHaveBeenCalledTimes(1);
    expect(checkErc20BalanceMock).toHaveBeenCalledTimes(1);
    expect(checkHasGasMock).toHaveBeenCalledTimes(1);
  });

  test("succeeds but skips local persistence when the deposit event cannot be decoded", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementation(() => ({
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 222n,
        logs: [],
      }),
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleDepositCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.committedValue).toBeNull();
    expect(saveAccountMock).not.toHaveBeenCalled();
    expect(saveSyncMetaMock).not.toHaveBeenCalled();
  });

  test("rejects non-round machine-mode amounts unless explicitly overridden", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDepositCommand(
        "0.123456789123",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "may reduce privacy",
    );
    expect(exitCode).toBe(2);
  });

  test("lets humans cancel on the non-round privacy warning before any transaction work", async () => {
    useIsolatedHome({ withSigner: true });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleDepositCommand(
        "0.011",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("may reduce your privacy");
    expect(stderr).toContain("Deposit cancelled");
    expect(depositETHMock).not.toHaveBeenCalled();
  });

  test("lets humans cancel at the final deposit confirmation step", async () => {
    useIsolatedHome({ withSigner: true });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stderr } = await captureAsyncOutput(() =>
      handleDepositCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Vetting fee");
    expect(stderr).toContain("Deposit cancelled");
    expect(depositETHMock).not.toHaveBeenCalled();
  });

  test("fails closed when ERC20 approval confirmation times out", async () => {
    useIsolatedHome({ withSigner: true });
    resolvePoolMock.mockImplementation(async () => USDC_POOL);
    getPublicClientMock.mockImplementation(() => ({
      waitForTransactionReceipt: async ({ hash }: { hash: string }) => {
        if (hash === "0x" + "12".repeat(32)) {
          throw new Error("approval timeout");
        }
        return {
          status: "success",
          blockNumber: 222n,
          logs: [],
        };
      },
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDepositCommand(
        "100",
        "USDC",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Timed out waiting for approval confirmation",
    );
    expect(depositERC20Mock).not.toHaveBeenCalled();
    expect(exitCode).toBe(3);
  });

  test("fails closed when the deposit transaction reverts onchain", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementation(() => ({
      waitForTransactionReceipt: async () => ({
        status: "reverted",
        blockNumber: 222n,
        logs: [],
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDepositCommand(
        "0.25",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("CONTRACT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Deposit transaction reverted",
    );
    expect(saveAccountMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(7);
  });

  test("continues after confirmation when local deposit persistence fails", async () => {
    useIsolatedHome({ withSigner: true });
    confirmPromptMock.mockImplementation(async () => true);
    saveAccountMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    const { stderr } = await captureAsyncOutput(() =>
      handleDepositCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("failed to save locally");
    expect(stderr).toContain("Run 'privacy-pools sync'");
    expect(stderr).toContain("Deposit confirmed");
  });
});
