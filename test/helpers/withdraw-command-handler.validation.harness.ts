import { expect, test } from "bun:test";
import {
  APPROVED_POOL_ACCOUNT,
  DEFAULT_RELAYER_FEE_RECEIVER,
  PENDING_POOL_ACCOUNT,
  accountHasDepositsMock,
  buildAllPoolAccountRefsMock,
  buildLoadedAspDepositReviewStateMock,
  buildPoolAccountRefsMock,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
  describeUnavailablePoolAccountMock,
  fakeCommand,
  fetchMerkleLeavesMock,
  fetchMerkleRootsMock,
  getPublicClientMock,
  getRelayerDetailsMock,
  getUnknownPoolAccountErrorMock,
  handleWithdrawCommand,
  initializeAccountServiceMock,
  listPoolsMock,
  maybeRenderPreviewProgressStepMock,
  maybeRenderPreviewScenarioMock,
  requestQuoteMock,
  resolvePoolMock,
  useIsolatedHome,
} from "./withdraw-command-handler.shared.ts";

export function registerWithdrawValidationPreludeTests(): void {
  test("rejects ambiguous amount/asset positional input before parsing account state", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "0.2",
        { to: "0x4444444444444444444444444444444444444444" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_INVALID_ASSET");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Could not infer amount/asset positional arguments for withdraw",
    );
    expect(exitCode).toBe(2);
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("short-circuits withdraw --dry-run when no Pool Accounts exist yet", async () => {
    useIsolatedHome({ withSigner: true });
    accountHasDepositsMock.mockImplementationOnce(() => false);

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ACCOUNT_NOT_FOUND");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No Pool Accounts are available for withdrawal yet.",
    );
    expect(json.error.nextActions).toEqual([
      expect.objectContaining({
        command: "flow start",
        when: "after_dry_run",
        args: ["0.1", "ETH"],
        parameters: [{ name: "to", type: "address", required: true }],
      }),
      expect.objectContaining({
        command: "deposit",
        when: "after_dry_run",
        args: ["0.1", "ETH"],
      }),
    ]);
    expect(exitCode).toBe(2);
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("rejects malformed --pool-account selectors before touching account state", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          poolAccount: "banana",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Invalid --pool-account");
    expect(exitCode).toBe(2);
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("fails closed in machine mode when no withdrawal amount is supplied", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        undefined,
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_MISSING_AMOUNT");
    expect(json.error.message ?? json.errorMessage).toContain("Missing amount");
    expect(exitCode).toBe(2);
  });

  test("fails closed in machine mode when --all omits the asset", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        undefined,
        undefined,
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_MISSING_ASSET");
    expect(json.error.message ?? json.errorMessage).toContain("--all requires an asset");
    expect(exitCode).toBe(2);
  });

  test("fails closed when --all is combined with an explicit amount", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "ETH",
        "0.1",
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Remove the amount when using --all",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects percentage withdrawals outside the supported 1-100 range", async () => {
    useIsolatedHome({ withSigner: true });

    const zeroPercent = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0%",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );
    expect(zeroPercent.json.success).toBe(false);
    expect(zeroPercent.json.error.message ?? zeroPercent.json.errorMessage).toContain(
      "Invalid percentage",
    );
    expect(zeroPercent.exitCode).toBe(2);

    const tooLarge = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "101%",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );
    expect(tooLarge.json.success).toBe(false);
    expect(tooLarge.json.error.message ?? tooLarge.json.errorMessage).toContain(
      "Invalid percentage",
    );
    expect(tooLarge.exitCode).toBe(2);
  });

  test("fails cleanly for humans when no pools are available to choose from", async () => {
    useIsolatedHome({ withSigner: true });
    listPoolsMock.mockImplementationOnce(async () => []);

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(2);
    expect(stderr).toContain("No pools found on mainnet");
  });

  test("returns early when withdraw preview rendering takes over the command", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async (commandKey: string) =>
      commandKey === "withdraw"
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over account sync", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewProgressStepMock.mockImplementationOnce(
      async (stepId: string) => stepId === "withdraw.sync-account-state",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Using relayed withdrawal");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over Pool Account selection", async () => {
    useIsolatedHome({ withSigner: true });
    const secondApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 2,
      paId: "PA-2",
      value: 2000000000000000000n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 502n,
        label: 602n,
        value: 2000000000000000000n,
      },
      label: 602n,
      txHash: "0x" + "bb".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      secondApprovedPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      secondApprovedPoolAccount,
    ]);
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey: string) =>
      commandKey === "withdraw pa select"
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(requestQuoteMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over Pool Account selection after account sync", async () => {
    useIsolatedHome({ withSigner: true });
    const secondApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 2,
      paId: "PA-2",
      value: 2000000000000000000n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 502n,
        label: 602n,
        value: 2000000000000000000n,
      },
      label: 602n,
      txHash: "0x" + "bb".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      secondApprovedPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      secondApprovedPoolAccount,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["601", "602"],
      stateTreeLeaves: ["501", "502"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(["601", "602"]),
      reviewStatuses: new Map<string, string>([
        ["601", "approved"],
        ["602", "approved"],
      ]),
    }));
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string, options?: { timing?: string }) =>
        commandKey === "withdraw pa select" && options?.timing === "after-prompts",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Using relayed withdrawal");
    expect(requestQuoteMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over the relayer quote step", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewProgressStepMock.mockImplementation(
      async (commandKey: string) => commandKey === "withdraw.request-quote",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Using relayed withdrawal");
    expect(getRelayerDetailsMock).not.toHaveBeenCalled();
    expect(requestQuoteMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over proof generation", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewProgressStepMock.mockImplementation(
      async (stepId: string) => stepId === "withdraw.generate-proof",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Using direct withdrawal");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("rejects unsupported unsigned formats before loading account state", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
          unsigned: "raw",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      'Unsupported unsigned format: "raw".',
    );
    expect(exitCode).toBe(2);
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("fails closed in machine mode when relayed withdrawals omit --to", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Relayed withdrawals require --to",
    );
    expect(exitCode).toBe(2);
  });

  test("returns early when preview rendering takes over recipient input", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string) => commandKey === "withdraw recipient input",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over final confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string) => commandKey === "withdraw confirm",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over direct confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string) => commandKey === "withdraw direct confirm",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Using direct withdrawal");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over relayed submission", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewProgressStepMock.mockImplementation(
      async (commandKey: string) => commandKey === "withdraw.submit-relayed",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Using relayed withdrawal");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
    expect(requestQuoteMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over direct submission", async () => {
    useIsolatedHome({ withSigner: true });
    maybeRenderPreviewProgressStepMock.mockImplementation(
      async (commandKey: string) => commandKey === "withdraw.submit-direct",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Using direct withdrawal");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
    expect(requestQuoteMock).not.toHaveBeenCalled();
  });

  test("reports that extra gas is not applicable for native-asset dry runs", async () => {
    useIsolatedHome({ withSigner: true });

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          dryRun: true,
          extraGas: true,
          poolAccount: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain(
      "Extra gas is not applicable for native-asset withdrawals",
    );
  });

}
export function registerWithdrawValidationAccountSelectionTests(): void {
  test("resolves --all withdrawals to the full selected Pool Account balance", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "ETH",
        undefined,
        {
          all: true,
          dryRun: true,
          poolAccount: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.amount).toBe("1000000000000000000");
    expect(json.poolAccountId).toBe("PA-1");
  });

  test("resolves percentage withdrawals against the selected Pool Account balance", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "50%",
        "ETH",
        {
          dryRun: true,
          poolAccount: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.amount).toBe("500000000000000000");
    expect(json.poolAccountId).toBe("PA-1");
  });

  test("auto-selects the largest approved Pool Account for deferred withdrawals", async () => {
    useIsolatedHome();
    const largerApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 4,
      paId: "PA-4",
      value: 3000000000000000000n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 504n,
        label: 604n,
        value: 3000000000000000000n,
      },
      label: 604n,
      txHash: "0x" + "cc".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["601", "604"],
      stateTreeLeaves: ["501", "504"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(["601", "604"]),
      reviewStatuses: new Map<string, string>([
        ["601", "approved"],
        ["604", "approved"],
      ]),
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "50%",
        "ETH",
        {
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.poolAccountId).toBe("PA-4");
    expect(json.amount).toBe("1500000000000000000");
  });

  test("human --yes all-withdrawals announce the selected Pool Account and full balance", async () => {
    useIsolatedHome({ withSigner: true });
    const largerApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 4,
      paId: "PA-4",
      value: 3000000000000000000n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 504n,
        label: 604n,
        value: 3000000000000000000n,
      },
      label: 604n,
      txHash: "0x" + "cc".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["601", "604"],
      stateTreeLeaves: ["501", "504"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(["601", "604"]),
      reviewStatuses: new Map<string, string>([
        ["601", "approved"],
        ["604", "approved"],
      ]),
    }));

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "ETH",
        undefined,
        {
          all: true,
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet", yes: true }),
      ),
    );

    expect(stderr).toContain("Pool Account:         PA-4");
    expect(stderr).toContain("Amount:               3 ETH");
  });

  test("human --yes percentage withdrawals announce the computed deferred amount", async () => {
    useIsolatedHome({ withSigner: true });

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "37.5%",
        "ETH",
        {
          dryRun: true,
          poolAccount: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet", yes: true }),
      ),
    );

    expect(stderr).toContain("Pool Account:         PA-1");
    expect(stderr).toContain("Amount:               0.375 ETH");
  });

  test("breaks equal-balance approved Pool Account ties by label", async () => {
    useIsolatedHome();
    const lowerLabelPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 2,
      paId: "PA-2",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 500n,
        label: 600n,
      },
      label: 600n,
      txHash: "0x" + "bb".repeat(32),
    };
    const higherLabelPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 501n,
        label: 601n,
      },
      label: 601n,
      txHash: "0x" + "cc".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      higherLabelPoolAccount,
      lowerLabelPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      higherLabelPoolAccount,
      lowerLabelPoolAccount,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["600", "601"],
      stateTreeLeaves: ["500", "501"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(["600", "601"]),
      reviewStatuses: new Map<string, string>([
        ["600", "approved"],
        ["601", "approved"],
      ]),
    }));

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet", yes: true }),
      ),
    );

    expect(stderr).toContain("Pool Account:         PA-2");
  });

  test("keeps the original order when equal-balance approved Pool Accounts also share the same label", async () => {
    useIsolatedHome();
    const firstApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 2,
      paId: "PA-2",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 500n,
        label: 600n,
      },
      label: 600n,
      txHash: "0x" + "bb".repeat(32),
    };
    const secondApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 501n,
        label: 600n,
      },
      label: 600n,
      txHash: "0x" + "cc".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      firstApprovedPoolAccount,
      secondApprovedPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      firstApprovedPoolAccount,
      secondApprovedPoolAccount,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["600"],
      stateTreeLeaves: ["500", "501"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(["600"]),
      reviewStatuses: new Map<string, string>([
        ["600", "approved"],
      ]),
    }));

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet", yes: true }),
      ),
    );

    expect(stderr).toContain("Pool Account:         PA-2");
  });

  test("fails closed when --all is combined with a positional amount", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "ETH",
        "0.1",
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Remove the amount when using --all",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed in machine mode when no asset is supplied", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_MISSING_ASSET");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No asset specified",
    );
    expect(exitCode).toBe(2);
  });

  test("requires an explicit recipient for direct unsigned withdrawals", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Direct withdrawal requires --to");
    expect(exitCode).toBe(2);
  });

  test("rejects direct withdrawals whose recipient does not match the signer", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          to: "0x9999999999999999999999999999999999999999",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_DIRECT_WITHDRAW_RECIPIENT_MISMATCH");
    expect(json.error.message ?? json.errorMessage).toContain("must match your signer address");
    expect(exitCode).toBe(2);
  });

  test("rejects Pool Accounts that cannot cover the requested amount", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "2",
        "ETH",
        {
          poolAccount: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No Pool Account has enough balance",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when no active Pool Accounts remain for the selected pool", async () => {
    useIsolatedHome({ withSigner: true });
    buildPoolAccountRefsMock.mockImplementationOnce(() => []);
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No Pool Account has enough balance",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed with the deposit-first hint when the selected pool has no saved Pool Accounts at all", async () => {
    useIsolatedHome({ withSigner: true });
    initializeAccountServiceMock.mockImplementationOnce(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () => new Map(),
      createWithdrawalSecrets: () => ({
        nullifier: 901n,
        secret: 902n,
      }),
      addWithdrawalCommitment: () => undefined,
    }));
    buildPoolAccountRefsMock.mockImplementationOnce(() => []);
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No Pool Account has enough balance",
    );
    expect(json.error.hint).toContain("Deposit first");
    expect(exitCode).toBe(2);
  });

  test("surfaces ACCOUNT_NOT_APPROVED when the selected Pool Account is still pending", async () => {
    useIsolatedHome({ withSigner: true });
    buildPoolAccountRefsMock.mockImplementationOnce(() => [PENDING_POOL_ACCOUNT]);
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [PENDING_POOL_ACCOUNT]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: [],
      stateTreeLeaves: ["502"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(),
      reviewStatuses: new Map<string, string>([["602", "pending"]]),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          poolAccount: "PA-2",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ACCOUNT_NOT_APPROVED");
    expect(json.error.hint).toContain("accounts --chain mainnet");
    expect(exitCode).toBe(2);
  });

  test("surfaces ACCOUNT_NOT_APPROVED when a requested Pool Account is active but not approved", async () => {
    useIsolatedHome({ withSigner: true });
    buildPoolAccountRefsMock.mockImplementationOnce(() => [
      APPROVED_POOL_ACCOUNT,
      PENDING_POOL_ACCOUNT,
    ]);
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [
      APPROVED_POOL_ACCOUNT,
      PENDING_POOL_ACCOUNT,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["601"],
      stateTreeLeaves: ["501", "502"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(["601"]),
      reviewStatuses: new Map<string, string>([
        ["601", "approved"],
        ["602", "pending"],
      ]),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          poolAccount: "PA-2",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ACCOUNT_NOT_APPROVED");
    expect(json.error.message ?? json.errorMessage).toContain(
      "PA-2 is not currently approved for withdrawal",
    );
    expect(json.error.hint).toContain("accounts --chain mainnet");
    expect(exitCode).toBe(2);
  });

  test("surfaces unavailable historical Pool Accounts through --pool-account", async () => {
    useIsolatedHome({ withSigner: true });
    const spentPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      status: "spent",
      aspStatus: "approved",
      value: 0n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 503n,
        label: 603n,
        value: 0n,
      },
      label: 603n,
    };
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [
      APPROVED_POOL_ACCOUNT,
      spentPoolAccount,
    ]);
    describeUnavailablePoolAccountMock.mockImplementationOnce(
      () => "PA-3 has already been spent and has no remaining balance.",
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          poolAccount: "PA-3",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("already been spent");
    expect(json.error.hint).toContain("inspect PA-3");
    expect(exitCode).toBe(2);
  });

  test("surfaces unknown Pool Accounts through --pool-account", async () => {
    useIsolatedHome({ withSigner: true });
    getUnknownPoolAccountErrorMock.mockImplementationOnce(() => ({
      message: "PA-99 is not part of this pool.",
      hint: "Choose an existing Pool Account from privacy-pools accounts.",
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          poolAccount: "PA-99",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("PA-99 is not part of this pool");
    expect(json.error.hint).toContain("privacy-pools accounts");
    expect(exitCode).toBe(2);
  });

  test("rejects explicitly selected Pool Accounts that cannot cover the requested amount", async () => {
    useIsolatedHome({ withSigner: true });
    const largerApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 4,
      paId: "PA-4",
      value: 3000000000000000000n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 504n,
        label: 604n,
        value: 3000000000000000000n,
      },
      label: 604n,
      txHash: "0x" + "cc".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["601", "604"],
      stateTreeLeaves: ["501", "504"],
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "2",
        "ETH",
        {
          poolAccount: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "PA-1 has insufficient balance",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when the relayer minimum exceeds the requested amount", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "9000000000000000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RELAYER_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("below relayer minimum");
    expect(exitCode).toBe(5);
  });

  test("fails closed when ASP roots are still converging", async () => {
    useIsolatedHome({ withSigner: true });
    fetchMerkleRootsMock.mockImplementationOnce(async () => ({
      mtRoot: "1",
      onchainMtRoot: "2",
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ASP_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("still updating");
    expect(exitCode).toBe(8);
  });

  test("fails closed when ASP root parity drifts from the onchain latest root", async () => {
    useIsolatedHome({ withSigner: true });
    fetchMerkleRootsMock.mockImplementationOnce(async () => ({
      mtRoot: "1",
      onchainMtRoot: "1",
    }));
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "latestRoot" ? 2n : 1n,
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 456n,
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ASP_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "out of sync with the chain",
    );
    expect(exitCode).toBe(8);
  });

}
export function registerWithdrawValidationPostQuoteTests(): void {
  test("fails closed when relayed withdrawals omit the recipient in machine mode", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "require --to",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects unsupported unsigned output formats before loading account state", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
          unsigned: "raw" as "raw",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      'Unsupported unsigned format: "raw"',
    );
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  test("requires an asset when --all is used", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        undefined,
        undefined,
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_MISSING_ASSET");
    expect(json.error.message ?? json.errorMessage).toContain("--all requires an asset");
    expect(exitCode).toBe(2);
  });

  test("rejects invalid percentage withdrawals before loading pool state", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "150%",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Invalid percentage");
    expect(resolvePoolMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

}
