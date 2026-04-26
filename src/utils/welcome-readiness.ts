import { CHAINS } from "../config/chains.js";
import { accountHasDeposits } from "../services/account-storage.js";
import {
  configExists,
  loadSignerKey,
  mnemonicExists,
} from "../services/config.js";
import {
  isTerminalFlowPhase,
  listSavedWorkflowIds,
  loadWorkflowSnapshot,
  type FlowPhase,
} from "../services/workflow.js";

export interface WelcomeAction {
  cliCommand: string;
  description: string;
}

export type WelcomeStateKind =
  | "new_user"
  | "read_only_no_deposits"
  | "read_only_with_deposits"
  | "ready_no_deposits"
  | "ready_with_deposits"
  | "workflow_active"
  | "fallback";

export interface WelcomeState {
  kind: WelcomeStateKind;
  readinessLabel: string;
  bannerHint?: string;
  bannerActions: WelcomeAction[];
  screenActions: WelcomeAction[];
}

const WELCOME_ACTIONS: Record<string, WelcomeAction> = {
  status: {
    cliCommand: "status",
    description: "check setup and network",
  },
  init: {
    cliCommand: "init",
    description: "guided account setup",
  },
  "init --recovery-phrase-file <downloaded-file>": {
    cliCommand: "init --recovery-phrase-file <downloaded-file>",
    description: "load existing account",
  },
  "init --signer-only": {
    cliCommand: "init --signer-only",
    description: "finish setup with signer key",
  },
  guide: {
    cliCommand: "guide",
    description: "concepts and reference",
  },
  "--help": {
    cliCommand: "--help",
    description: "all commands",
  },
  "flow start 0.1 ETH": {
    cliCommand: "flow start 0.1 ETH",
    description: "deposit, then withdraw privately",
  },
  pools: {
    cliCommand: "pools",
    description: "browse pools",
  },
  accounts: {
    cliCommand: "accounts",
    description: "view balances",
  },
  "accounts --pending-only": {
    cliCommand: "accounts --pending-only",
    description: "check ASP review",
  },
  "flow status latest": {
    cliCommand: "flow status latest",
    description: "check saved workflow",
  },
  "flow watch latest": {
    cliCommand: "flow watch latest",
    description: "resume saved workflow",
  },
};

function resolveActions(commands: readonly string[]): WelcomeAction[] {
  return commands.map((command) => WELCOME_ACTIONS[command]);
}

export const DEFAULT_WELCOME_BANNER_ACTIONS = resolveActions([
  "init",
  "guide",
  "--help",
]);

export const DEFAULT_WELCOME_SCREEN_ACTIONS = resolveActions([
  "status",
  "init",
  "init --recovery-phrase-file <downloaded-file>",
  "guide",
  "--help",
]);

function buildWelcomeState(
  kind: WelcomeStateKind,
  readinessLabel: string,
  bannerCommands: readonly string[],
  screenCommands: readonly string[],
  bannerHint?: string,
): WelcomeState {
  return {
    kind,
    readinessLabel,
    ...(bannerHint ? { bannerHint } : {}),
    bannerActions: resolveActions(bannerCommands),
    screenActions: resolveActions(screenCommands),
  };
}

function fallbackWelcomeState(readinessLabel: string = "setup: check status"): WelcomeState {
  return buildWelcomeState(
    "fallback",
    readinessLabel,
    ["status", "guide", "--help"],
    [
      "status",
      "init",
      "init --recovery-phrase-file <downloaded-file>",
      "guide",
      "--help",
    ],
  );
}

function hasSavedDeposits(): boolean {
  return Object.values(CHAINS).some((chain) => accountHasDeposits(chain.id));
}

function getLatestActiveWorkflowPhase(): FlowPhase | null {
  const [latestWorkflowId] = listSavedWorkflowIds();
  if (!latestWorkflowId) return null;

  const snapshot = loadWorkflowSnapshot(latestWorkflowId);
  return isTerminalFlowPhase(snapshot.phase) ? null : snapshot.phase;
}

export function getWelcomeState(): WelcomeState {
  try {
    const hasConfig = configExists();
    const hasRecoveryPhrase = mnemonicExists();
    const hasSignerKey =
      loadSignerKey() !== null ||
      (process.env.PRIVACY_POOLS_PRIVATE_KEY?.trim().length ?? 0) > 0;
    const activeWorkflowPhase = getLatestActiveWorkflowPhase();
    const hasDeposits = hasSavedDeposits();

    if (activeWorkflowPhase) {
      const pendingCommand =
        activeWorkflowPhase === "awaiting_asp"
          ? "accounts --pending-only"
          : "accounts";
      return buildWelcomeState(
        "workflow_active",
        "workflow: active",
        ["flow status latest", "flow watch latest", "--help"],
        [
          "flow status latest",
          "flow watch latest",
          pendingCommand,
          "guide",
          "--help",
        ],
      );
    }

    if (!hasConfig && !hasRecoveryPhrase && !hasSignerKey) {
      return buildWelcomeState(
        "new_user",
        "setup: run init",
        ["init", "guide", "--help"],
        [
          "status",
          "init",
          "init --recovery-phrase-file <downloaded-file>",
          "guide",
          "--help",
        ],
      );
    }

    if (!hasRecoveryPhrase) {
      return fallbackWelcomeState("setup: check status");
    }

    if (!hasSignerKey) {
      return hasDeposits
        ? buildWelcomeState(
            "read_only_with_deposits",
            "setup: read-only",
            ["status", "accounts", "--help"],
            [
              "status",
              "init --signer-only",
              "accounts",
              "guide",
              "--help",
            ],
          )
        : buildWelcomeState(
          "read_only_no_deposits",
          "setup: read-only",
          ["status", "pools", "--help"],
          [
            "status",
            "init --signer-only",
            "pools",
            "guide",
            "--help",
          ],
          "Browse pools now; add a signer key before depositing.",
        );
    }

    return hasDeposits
      ? buildWelcomeState(
          "ready_with_deposits",
          "setup: ready",
          ["accounts", "flow start 0.1 ETH", "--help"],
          [
            "accounts",
            "flow start 0.1 ETH",
            "status",
            "guide",
            "--help",
          ],
        )
      : buildWelcomeState(
          "ready_no_deposits",
          "setup: ready",
          ["flow start 0.1 ETH", "pools", "--help"],
          [
            "flow start 0.1 ETH",
            "pools",
            "status",
            "guide",
            "--help",
          ],
          "Flow = deposit + privacy delay + private withdrawal.",
        );
  } catch {
    return fallbackWelcomeState();
  }
}

export function getWelcomeReadinessLabel(): string {
  return getWelcomeState().readinessLabel;
}
