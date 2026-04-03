import { expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { captureAsyncOutput } from "../helpers/output.ts";
import {
  GLOBAL_SIGNER_ADDRESS,
  NEW_WALLET_ADDRESS,
  NEW_WALLET_PRIVATE_KEY,
  realConfig,
  setPromptResponses,
  startWorkflow,
  state,
  useImmediateTimers,
} from "../helpers/workflow-mocked.harness.ts";

export function registerWorkflowMockedInteractiveTests(): void {
    test("interactive configured flows confirm the manual signer path before saving the workflow", async () => {
      setPromptResponses();

      const snapshot = await startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: false,
        },
        isVerbose: false,
        watch: false,
      });

      expect(snapshot.phase).toBe("awaiting_asp");
      expect(snapshot.walletMode).toBe("configured");
      expect(snapshot.walletAddress).toBe(GLOBAL_SIGNER_ADDRESS);
      expect(snapshot.depositTxHash).toBe(state.depositTxHash);
    });
    test("interactive configured flows can cancel on the non-round amount privacy warning", async () => {
      setPromptResponses({ confirm: false });

      await expect(
        startWorkflow({
          amountInput: "0.011",
          assetInput: "ETH",
          recipient: "0x7777777777777777777777777777777777777777",
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: false,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        }),
      ).rejects.toThrow("Flow cancelled.");

      expect(state.depositEthCalls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
    });
    test("interactive configured flows can cancel at the final confirmation prompt", async () => {
      setPromptResponses({ confirm: false });

      await expect(
        startWorkflow({
          amountInput: "0.01",
          assetInput: "ETH",
          recipient: "0x7777777777777777777777777777777777777777",
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: false,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        }),
      ).rejects.toThrow("Flow cancelled.");

      expect(state.depositEthCalls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
    });
    test("interactive new-wallet flows can confirm backup and complete", async () => {
      setPromptResponses({ input: join(state.tempHome, "ignored-wallet.txt") });
      state.currentSignerPrivateKey = null;
      state.pool = {
        ...state.pool,
        asset: "0x8888888888888888888888888888888888888888",
        symbol: "USDC",
        decimals: 6,
      };
      state.tokenBalance = 100000000n;
      state.nativeBalance = 10n ** 18n;

      const backupPath = join(state.tempHome, "interactive-wallet.txt");
      const restoreTimers = useImmediateTimers();
      try {
        let snapshot: Awaited<ReturnType<typeof startWorkflow>> | null = null;
        const { stdout, stderr } = await captureAsyncOutput(async () => {
          snapshot = await startWorkflow({
            amountInput: "100",
            assetInput: "USDC",
            recipient: "0x7777777777777777777777777777777777777777",
            privacyDelayProfile: "off",
            newWallet: true,
            exportNewWallet: backupPath,
            globalOpts: { chain: "sepolia" },
            mode: {
              isAgent: false,
              isJson: false,
              isCsv: false,
              isQuiet: true,
              format: "table",
              skipPrompts: false,
            },
            isVerbose: false,
            watch: false,
          });
        });

        expect(stdout).toBe("");
        expect(stderr.trim()).toBe("");
        expect(snapshot).not.toBeNull();
        expect(snapshot!.phase).toBe("completed");
        expect(snapshot!.backupConfirmed).toBe(true);
        expect(readFileSync(backupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
      } finally {
        restoreTimers();
      }
    });
    test("interactive new-wallet flows can choose a backup file path and complete", async () => {
      const promptedBackupPath = join(state.tempHome, "prompted-wallet.txt");
      setPromptResponses({ input: promptedBackupPath, select: "file" });
      state.currentSignerPrivateKey = null;
      state.pool = {
        ...state.pool,
        asset: "0x8888888888888888888888888888888888888888",
        symbol: "USDC",
        decimals: 6,
      };
      state.tokenBalance = 100000000n;
      state.nativeBalance = 10n ** 18n;

      const restoreTimers = useImmediateTimers();
      try {
        let snapshot: Awaited<ReturnType<typeof startWorkflow>> | null = null;
        const { stdout, stderr } = await captureAsyncOutput(async () => {
          snapshot = await startWorkflow({
            amountInput: "100",
            assetInput: "USDC",
            recipient: "0x7777777777777777777777777777777777777777",
            privacyDelayProfile: "off",
            newWallet: true,
            globalOpts: { chain: "sepolia" },
            mode: {
              isAgent: false,
              isJson: false,
              isCsv: false,
              isQuiet: true,
              format: "table",
              skipPrompts: false,
            },
            isVerbose: false,
            watch: false,
          });
        });

        expect(stdout).toBe("");
        expect(stderr.trim()).toBe("");
        expect(snapshot).not.toBeNull();
        expect(snapshot!.phase).toBe("completed");
        expect(readFileSync(promptedBackupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
      } finally {
        restoreTimers();
      }
    });
    test("interactive new-wallet flows persist ERC20 funding requirements for follow-up", async () => {
      const promptedBackupPath = join(state.tempHome, "visible-wallet.txt");
      setPromptResponses({ input: promptedBackupPath, select: "file" });
      state.currentSignerPrivateKey = null;
      state.pool = {
        ...state.pool,
        asset: "0x8888888888888888888888888888888888888888",
        symbol: "USDC",
        decimals: 6,
      };
      state.tokenBalance = 100000000n;
      state.nativeBalance = 10n ** 18n;

      const restoreTimers = useImmediateTimers();
      try {
        const { stderr } = await captureAsyncOutput(async () => {
          const snapshot = await startWorkflow({
            amountInput: "100",
            assetInput: "USDC",
            recipient: "0x7777777777777777777777777777777777777777",
            privacyDelayProfile: "off",
            newWallet: true,
            globalOpts: { chain: "sepolia" },
            mode: {
              isAgent: false,
              isJson: false,
              isCsv: false,
              isQuiet: false,
              format: "table",
              skipPrompts: false,
            },
            isVerbose: false,
            watch: false,
          });

          expect(snapshot.walletAddress).toBe(NEW_WALLET_ADDRESS);
          expect(snapshot.requiredTokenFunding).toBe("100000000");
          expect(BigInt(snapshot.requiredNativeFunding ?? "0")).toBeGreaterThan(0n);
        });

        expect(stderr).toContain("Expected net deposited:");
        expect(stderr).toContain("Auto-withdrawal:");
        expect(stderr).toContain(
          "The recipient receives the net amount after relayer fees and any ERC20 extra-gas funding.",
        );
        expect(stderr).toContain("Privacy delay: Off (no added hold)");
        expect(stderr).toContain(
          "Privacy delay is disabled for this saved flow.",
        );
        expect(stderr).toContain("Wallet setup:");
        expect(stderr).toContain("\n");
        expect(readFileSync(promptedBackupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
      } finally {
        restoreTimers();
      }
    });
    test("interactive new-wallet flows can cancel at the shared flow review prompt", async () => {
      setPromptResponses({ confirm: false });
      state.currentSignerPrivateKey = null;

      await expect(
        startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          newWallet: true,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: false,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        }),
      ).rejects.toThrow("Flow cancelled.");

      const secretFiles = existsSync(realConfig.getWorkflowSecretsDir())
        ? readdirSync(realConfig.getWorkflowSecretsDir())
        : [];
      expect(secretFiles).toHaveLength(0);
    });
    test("interactive new-wallet flows stop when backup confirmation is declined", async () => {
      setPromptResponses({ confirm: [true, false] });
      state.currentSignerPrivateKey = null;

      const { stdout, stderr } = await captureAsyncOutput(async () => {
        await expect(
          startWorkflow({
            amountInput: "100",
            assetInput: "USDC",
            recipient: "0x7777777777777777777777777777777777777777",
            newWallet: true,
            globalOpts: { chain: "sepolia" },
            mode: {
              isAgent: false,
              isJson: false,
              isCsv: false,
              isQuiet: true,
              format: "table",
              skipPrompts: false,
            },
            isVerbose: false,
            watch: false,
          }),
        ).rejects.toThrow("You must confirm that the workflow wallet is backed up.");
      });
      expect(stdout).toBe("");
      expect(stderr).toContain("Private key:");
      expect(stderr).toContain(NEW_WALLET_PRIVATE_KEY);
    });
}
