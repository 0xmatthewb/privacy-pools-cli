import { describe, test } from "bun:test";
import {
  createTempHome,
  mustInitSeededHome,
  runCli,
} from "../helpers/cli.ts";
import {
  assertCapabilitiesAgentContract,
  assertDescribeWithdrawQuoteAgentContract,
  assertGuideAgentContract,
  assertStatusDegradedHealthAgentContract,
  assertStatusSetupRequiredAgentContract,
  assertUnknownCommandAgentContract,
} from "../helpers/agent-contract.ts";

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RPC_URL: "http://127.0.0.1:9",
};

describe("agent contract", () => {
  test("guide --agent stays quiet and machine-readable", () => {
    assertGuideAgentContract(
      runCli(["--agent", "guide"], { home: createTempHome() }),
    );
  });

  test("capabilities --agent keeps safety metadata stable", () => {
    assertCapabilitiesAgentContract(
      runCli(["--agent", "capabilities"], { home: createTempHome() }),
    );
  });

  test("describe withdraw quote --agent keeps the detailed descriptor stable", () => {
    assertDescribeWithdrawQuoteAgentContract(
      runCli(["--agent", "describe", "withdraw", "quote"], {
        home: createTempHome(),
      }),
    );
  });

  test("status --agent --no-check reports setup-required guidance without chatter", () => {
    assertStatusSetupRequiredAgentContract(
      runCli(["--agent", "status", "--no-check"], {
        home: createTempHome(),
      }),
    );
  });

  test("status --agent --check reports degraded-health guidance without chatter", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    assertStatusDegradedHealthAgentContract(
      runCli(["--agent", "status", "--check"], {
        home,
        env: OFFLINE_ENV,
        timeoutMs: 30_000,
      }),
    );
  });

  test("unknown commands stay machine-readable in --agent mode", () => {
    assertUnknownCommandAgentContract(
      runCli(["--agent", "not-a-command"], {
        home: createTempHome(),
      }),
    );
  });
});
