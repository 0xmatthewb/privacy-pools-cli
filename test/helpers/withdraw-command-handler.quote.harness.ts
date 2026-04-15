import { expect, test } from "bun:test";
import {
  CLIError,
  ETH_POOL,
  OP_SEPOLIA_WETH_POOL,
  USDC_POOL,
  buildRelayerQuote,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  fakeQuoteCommand,
  handleWithdrawQuoteCommand,
  maybeRenderPreviewScenarioMock,
  requestQuoteMock,
  resolvePoolMock,
  useIsolatedHome,
} from "./withdraw-command-handler.shared.ts";

export function registerWithdrawQuoteTests(): void {
  test("returns early when preview rendering takes over the quote command", async () => {
    useIsolatedHome();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {},
        fakeQuoteCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(resolvePoolMock).not.toHaveBeenCalled();
    expect(requestQuoteMock).not.toHaveBeenCalled();
  });

  test("returns a structured relayer quote in JSON mode", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {
          to: "0x7777777777777777777777777777777777777777",
        },
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("relayed-quote");
    expect(json.asset).toBe("ETH");
    expect(json.quoteFeeBPS).toBe("250");
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "withdraw",
          when: "after_quote",
        }),
      ]),
    );
  });

  test("quote returns a template follow-up when no recipient is supplied", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.recipient).toBeNull();
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "withdraw",
          runnable: false,
        }),
      ]),
    );
  });

  test("renders a human quote when --asset is passed via the quote command and warns about the deprecated flag", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {
          asset: "ETH",
          to: "0x7777777777777777777777777777777777777777",
        },
        fakeQuoteCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("--asset is deprecated for withdraw quote");
    expect(stderr).toContain("Quote received");
    expect(stderr).toContain("0x7777");
  });

  test("quote fails closed when no asset is supplied", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No asset specified",
    );
    expect(exitCode).toBe(2);
  });

  test("quote validates positive amounts before requesting relayer details", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawQuoteCommand(
        "0",
        "ETH",
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Quote amount");
    expect(requestQuoteMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  test("quote rejects invalid inherited recipient addresses before requesting quotes", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand(
          { json: true, chain: "mainnet" },
          {
            asset: "ETH",
            to: "not-an-address",
          },
        ),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Recipient");
    expect(requestQuoteMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  test("quote inherits parent withdraw flags and suppresses extra gas for native assets", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand(
          { chain: "mainnet" },
          {
            asset: "ETH",
            to: "0x7777777777777777777777777777777777777777",
            extraGas: true,
          },
        ),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain(
      "Extra gas is not applicable for native-asset withdrawals",
    );
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        asset: ETH_POOL.asset,
        extraGas: false,
        recipient: "0x7777777777777777777777777777777777777777",
      }),
    );
  });

  test("quote inherits parent asset and recipient flags for ERC20 pools", async () => {
    useIsolatedHome();
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "100",
        undefined,
        {},
        fakeQuoteCommand(
          { json: true, chain: "mainnet" },
          {
            asset: "USDC",
            to: "0x7777777777777777777777777777777777777777",
            extraGas: true,
          },
        ),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.asset).toBe("USDC");
    expect(json.recipient).toBe("0x7777777777777777777777777777777777777777");
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        asset: USDC_POOL.asset,
        extraGas: true,
        recipient: "0x7777777777777777777777777777777777777777",
      }),
    );
  });

  test("quote suppresses extra gas for op-sepolia WETH native-ux withdrawals", async () => {
    useIsolatedHome();
    resolvePoolMock.mockImplementationOnce(async () => OP_SEPOLIA_WETH_POOL);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand(
          { chain: "op-sepolia" },
          {
            asset: "WETH",
            to: "0x7777777777777777777777777777777777777777",
            extraGas: true,
          },
        ),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain(
      "Extra gas is not applicable for native-asset withdrawals",
    );
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        asset: OP_SEPOLIA_WETH_POOL.asset,
        extraGas: false,
        recipient: "0x7777777777777777777777777777777777777777",
      }),
    );
  });

  test("quote keeps feeCommitmentPresent false when the relayer omits fee commitment details", async () => {
    useIsolatedHome();
    requestQuoteMock.mockImplementationOnce(async () => ({
      baseFeeBPS: "200",
      feeBPS: "250",
      gasPrice: "1",
      detail: { relayTxCost: { gas: "0", eth: "0" } },
      feeCommitment: null,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.feeCommitmentPresent).toBe(false);
    expect(json.quoteExpiresAt).toBeNull();
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relayerUrl: "https://fastrelay.xyz",
      }),
    );
  });

  test("quote downgrades unsupported extra gas requests and keeps the result machine-readable", async () => {
    useIsolatedHome();
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);
    requestQuoteMock
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params?.extraGas).toBe(true);
        throw new CLIError(
          "Relayer returned UNSUPPORTED_FEATURE for extra gas.",
          "RELAYER",
          "UNSUPPORTED_FEATURE",
        );
      })
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params?.extraGas).toBe(false);
        return buildRelayerQuote({
          recipient: params?.recipient,
          asset: USDC_POOL.asset,
          amount: params?.amount?.toString(),
          extraGas: false,
        });
      });

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "100",
        "USDC",
        {
          to: "0x7777777777777777777777777777777777777777",
        },
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(json.success).toBe(true);
    expect(json.extraGas).toBe(false);
  });

  test("quote warns humans when the relayer downgrades unsupported extra gas", async () => {
    useIsolatedHome();
    resolvePoolMock.mockImplementationOnce(async () => USDC_POOL);
    requestQuoteMock
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params?.extraGas).toBe(true);
        throw new CLIError(
          "Relayer returned UNSUPPORTED_FEATURE for extra gas.",
          "RELAYER",
          "UNSUPPORTED_FEATURE",
        );
      })
      .mockImplementationOnce(async (_chainConfig, params) =>
        buildRelayerQuote({
          recipient: params?.recipient,
          asset: USDC_POOL.asset,
          amount: params?.amount?.toString(),
          extraGas: false,
        })
      );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawQuoteCommand(
        "100",
        "USDC",
        {
          to: "0x7777777777777777777777777777777777777777",
        },
        fakeQuoteCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(stderr).toContain("Extra gas is not available for this relayer");
    expect(stderr).toContain("Quote received");
  });

}
