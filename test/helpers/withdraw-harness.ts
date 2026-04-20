import type { Address } from "viem";
import { CLIError } from "../../src/utils/errors.ts";
import {
  APPROVED_POOL_ACCOUNT,
  buildAllPoolAccountRefsMock,
  buildLoadedAspDepositReviewStateMock,
  buildPoolAccountRefsMock,
  buildRelayerQuote,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutputAllowExit,
  fakeCommand,
  fetchMerkleLeavesMock,
  fetchMerkleRootsMock,
  getPublicClientMock,
  getRelayerDetailsMock,
  handleWithdrawCommand,
  requestQuoteMock,
  resolveAddressOrEnsMock,
  submitRelayRequestMock,
  useIsolatedHome,
} from "./withdraw-command-handler.shared.ts";

type WithdrawPoolAccountRef = typeof APPROVED_POOL_ACCOUNT;

interface WithdrawHarnessRunOptions {
  amount?: string;
  asset?: string;
  opts?: Record<string, unknown>;
  globalOpts?: Record<string, unknown>;
  withSigner?: boolean;
}

interface WithdrawHarnessAspGateOptions {
  poolAccounts?: WithdrawPoolAccountRef[];
  allPoolAccounts?: WithdrawPoolAccountRef[];
  roots?: { mtRoot: string; onchainMtRoot: string };
  leaves?: { aspLeaves: string[]; stateTreeLeaves: string[] };
  approvedLabels?: Iterable<string>;
  reviewStatuses?: Iterable<[string, string]>;
}

interface WithdrawHarnessQuoteOptions {
  recipient?: Address;
  feeRecipient?: Address;
  feeBPS?: string;
  expiration?: number;
  asset?: Address;
  amount?: string;
  extraGas?: boolean;
  signedRelayerCommitment?: `0x${string}`;
  relayerUrl?: string;
}

type ReceiptResult =
  | {
      status: "success" | "reverted";
      blockNumber: bigint;
    }
  | Error;

export class WithdrawHarness {
  private withSignerValue = false;

  withSigner(enabled: boolean = true): this {
    this.withSignerValue = enabled;
    return this;
  }

  withPoolAccounts(
    poolAccounts: WithdrawPoolAccountRef[],
    allPoolAccounts: WithdrawPoolAccountRef[] = poolAccounts,
  ): this {
    buildPoolAccountRefsMock.mockImplementation(() => poolAccounts);
    buildAllPoolAccountRefsMock.mockImplementation(() => allPoolAccounts);
    return this;
  }

  withAspGate(options: WithdrawHarnessAspGateOptions = {}): this {
    if (options.poolAccounts || options.allPoolAccounts) {
      this.withPoolAccounts(
        options.poolAccounts ?? options.allPoolAccounts ?? [APPROVED_POOL_ACCOUNT],
        options.allPoolAccounts ?? options.poolAccounts ?? [APPROVED_POOL_ACCOUNT],
      );
    }

    fetchMerkleRootsMock.mockImplementation(async () => ({
      mtRoot: "1",
      onchainMtRoot: "1",
      ...(options.roots ?? {}),
    }));

    fetchMerkleLeavesMock.mockImplementation(async () => ({
      aspLeaves: ["601"],
      stateTreeLeaves: ["501"],
      ...(options.leaves ?? {}),
    }));

    buildLoadedAspDepositReviewStateMock.mockImplementation(() => ({
      approvedLabels: new Set(options.approvedLabels ?? ["601"]),
      reviewStatuses: new Map(options.reviewStatuses ?? [["601", "approved"]]),
    }));

    return this;
  }

  withRelayerDetails(
    details: Partial<Awaited<ReturnType<typeof getRelayerDetailsMock>>> = {},
  ): this {
    getRelayerDetailsMock.mockImplementation(async () => ({
      minWithdrawAmount: "10000000000000000",
      feeReceiverAddress: "0x3333333333333333333333333333333333333333",
      relayerUrl: "https://fastrelay.xyz",
      ...details,
    }));
    return this;
  }

  withRelayerQuote(options: WithdrawHarnessQuoteOptions): this {
    requestQuoteMock.mockImplementation(async (_chainConfig, params) =>
      buildRelayerQuote({
        recipient: params?.recipient,
        asset: params?.asset,
        amount: params?.amount?.toString(),
        extraGas: params?.extraGas,
        relayerUrl: params?.relayerUrl,
        ...options,
      }),
    );
    return this;
  }

  withRelayerQuoteSequence(
    quotes: WithdrawHarnessQuoteOptions[],
  ): this {
    requestQuoteMock.mockReset();
    for (const quote of quotes) {
      requestQuoteMock.mockImplementationOnce(async (_chainConfig, params) =>
        buildRelayerQuote({
          recipient: params?.recipient,
          asset: params?.asset,
          amount: params?.amount?.toString(),
          extraGas: params?.extraGas,
          relayerUrl: params?.relayerUrl,
          ...quote,
        }),
      );
    }
    return this;
  }

  withRecipientResolution(input: string, address: Address, ensName?: string): this {
    resolveAddressOrEnsMock.mockImplementation(async (candidate: string) => ({
      address: (candidate === input ? address : candidate) as Address,
      ...(candidate === input && ensName ? { ensName } : {}),
    }));
    return this;
  }

  withReceipt(result: ReceiptResult): this {
    getPublicClientMock.mockImplementation(() => ({
      readContract: async () => 1n,
      waitForTransactionReceipt: async () => {
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
    }));
    return this;
  }

  withRelaySubmission(result: { txHash: string } | Error): this {
    submitRelayRequestMock.mockImplementation(async () => {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    });
    return this;
  }

  withRetryExhaustion(message: string = "Relayer request failed after retries"): this {
    return this.withRelaySubmission(
      new CLIError(
        message,
        "RELAYER",
        "Wait a moment and retry, or switch to another relayer.",
        undefined,
        true,
      ),
    );
  }

  async run(options: WithdrawHarnessRunOptions = {}) {
    const amount = options.amount ?? "0.1";
    const asset = options.asset ?? "ETH";
    const globalOpts = {
      chain: "mainnet",
      json: true,
      ...(options.globalOpts ?? {}),
    };

    useIsolatedHome({ withSigner: options.withSigner ?? this.withSignerValue });

    if (globalOpts.json) {
      return captureAsyncJsonOutputAllowExit(() =>
        handleWithdrawCommand(
          amount,
          asset,
          options.opts ?? {},
          fakeCommand(globalOpts),
        ),
      );
    }

    return captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        amount,
        asset,
        options.opts ?? {},
        fakeCommand(globalOpts),
      ),
    );
  }
}
