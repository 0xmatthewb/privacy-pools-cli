import { describe, expect, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";
import {
  APPROVED_POOL_ACCOUNT,
  PENDING_POOL_ACCOUNT,
  registerWithdrawCommandHandlerHarness,
  submitRelayRequestMock,
  withdrawDirectMock,
} from "../helpers/withdraw-command-handler.shared.ts";
import { WithdrawHarness } from "../helpers/withdraw-harness.ts";

registerWithdrawCommandHandlerHarness();

describe("withdraw scenarios", () => {
  test("covers the happy path relayed scenario", async () => {
    const result = await new WithdrawHarness()
      .withSigner()
      .run({
        opts: {
          to: "0x4444444444444444444444444444444444444444",
        },
      });

    expect(result.exitCode).toBe(0);
    expect(result.json.success).toBe(true);
    expect(result.json.mode).toBe("relayed");
    expect(result.json.txHash).toBe("0x" + "34".repeat(32));
  });

  test("covers the happy path onchain scenario", async () => {
    const result = await new WithdrawHarness()
      .withSigner()
      .run({
        opts: {
          direct: true,
          confirmDirectWithdraw: true,
        },
      });

    expect(result.exitCode).toBe(0);
    expect(result.json.success).toBe(true);
    expect(result.json.mode).toBe("direct");
    expect(result.json.txHash).toBe("0x" + "56".repeat(32));
  });

  test("covers the asp-pending scenario", async () => {
    const result = await new WithdrawHarness()
      .withSigner()
      .withAspGate({
        poolAccounts: [PENDING_POOL_ACCOUNT],
        allPoolAccounts: [PENDING_POOL_ACCOUNT],
        leaves: {
          aspLeaves: [],
          stateTreeLeaves: ["502"],
        },
        approvedLabels: [],
        reviewStatuses: [["602", "pending"]],
      })
      .run({
        opts: {
          poolAccount: "PA-2",
          to: "0x4444444444444444444444444444444444444444",
        },
      });

    expect(result.json.success).toBe(false);
    expect(result.json.errorCode).toBe("ACCOUNT_NOT_APPROVED");
    expect(result.json.error.hint).toContain("accounts --chain mainnet");
  });

  test("covers the asp-rejected scenario", async () => {
    const declinedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      status: "declined" as const,
      aspStatus: "declined" as const,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 503n,
        label: 603n,
      },
      label: 603n,
      txHash: "0x" + "cc".repeat(32),
    };

    const result = await new WithdrawHarness()
      .withSigner()
      .withAspGate({
        poolAccounts: [declinedPoolAccount],
        allPoolAccounts: [declinedPoolAccount],
        leaves: {
          aspLeaves: [],
          stateTreeLeaves: ["503"],
        },
        approvedLabels: [],
        reviewStatuses: [["603", "declined"]],
      })
      .run({
        opts: {
          poolAccount: "PA-3",
          to: "0x4444444444444444444444444444444444444444",
        },
      });

    expect(result.json.success).toBe(false);
    expect(result.json.errorCode).toBe("ACCOUNT_NOT_APPROVED");
    expect(result.json.error.hint).toContain(
      "Ragequit is available to publicly recover funds",
    );
  });

  test("covers the ens warning scenario", async () => {
    const result = await new WithdrawHarness()
      .withRecipientResolution(
        "alice.eth",
        "0x4444444444444444444444444444444444444444",
        "alice.eth",
      )
      .run({
        globalOpts: {
          chain: "mainnet",
          json: false,
        },
        opts: {
          dryRun: true,
          to: "alice.eth",
        },
      });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "Resolved alice.eth -> 0x4444444444444444444444444444444444444444",
    );
  });

  test("covers the suspicious recipient scenario", async () => {
    const result = await new WithdrawHarness()
      .withSigner()
      .run({
        opts: {
          dryRun: true,
          to: "0x9999999999999999999999999999999999999999",
        },
      });

    expect(result.json.success).toBe(true);
    expect(result.json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "recipient_new_to_profile",
        }),
      ]),
    );
  });

  test("covers the dry-run scenario", async () => {
    const result = await new WithdrawHarness().run({
      opts: {
        dryRun: true,
        to: "0x4444444444444444444444444444444444444444",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.json.success).toBe(true);
    expect(result.json.dryRun).toBe(true);
    expect(submitRelayRequestMock).not.toHaveBeenCalled();
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("covers the watch-mode timeout scenario", async () => {
    const result = await new WithdrawHarness()
      .withSigner()
      .withReceipt(new Error("timeout"))
      .run({
        opts: {
          to: "0x4444444444444444444444444444444444444444",
        },
      });

    expect(result.json.success).toBe(false);
    expect(result.json.errorCode).toBe("RPC_NETWORK_ERROR");
    expect(result.json.error.message ?? result.json.errorMessage).toContain(
      "Timed out waiting for relayed withdrawal confirmation",
    );
  });

  test("covers the quote drift scenario", async () => {
    const originalNow = Date.now;
    const initialNow = 1_700_000_000_000;
    Date.now = () => initialNow;

    try {
      const result = await new WithdrawHarness()
        .withSigner()
        .withRelayerQuoteSequence([
          {
            expiration: initialNow + 11_000,
          },
          {
            feeBPS: "275",
            expiration: initialNow + 100_000,
            signedRelayerCommitment: "0x02",
          },
        ])
        .run({
          opts: {
            to: "0x4444444444444444444444444444444444444444",
          },
        });

      expect(result.json.success).toBe(false);
      expect(result.json.errorCode).toBe("RELAYER_ERROR");
      expect(result.json.error.message ?? result.json.errorMessage).toContain(
        "Relayer fee changed during pre-proof refresh",
      );
    } finally {
      Date.now = originalNow;
    }
  });

  test("covers the retry exhaustion scenario", async () => {
    const result = await new WithdrawHarness()
      .withSigner()
      .withRelaySubmission(
        new CLIError(
          "Relayer request failed after retries",
          "RELAYER",
          "Wait a moment and retry, or switch to another relayer.",
          undefined,
          true,
        ),
      )
      .run({
        opts: {
          to: "0x4444444444444444444444444444444444444444",
        },
      });

    expect(result.json.success).toBe(false);
    expect(result.json.errorCode).toBe("RELAYER_ERROR");
    expect(result.json.error.retryable).toBe(true);
    expect(result.json.error.message ?? result.json.errorMessage).toContain(
      "after retries",
    );
  });
});
