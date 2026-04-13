import { expect } from "bun:test";
import {
  assertExit,
  assertJson,
  assertStderr,
  assertStdout,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
  seedHome,
} from "./framework.ts";

const BANNER_SENTINEL =
  ",---. ,---. ,-.-.   .-.--.   ,--.-.   .-.   ,---.  .---.  .---. ,-.     .---.";

function assertCompletionLines(expected: string[]) {
  return assertStdout((stdout) => {
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const value of expected) {
      expect(lines).toContain(value);
    }
  });
}

defineScenarioSuite("completion acceptance", [
  defineScenario("completion scripts emit shell-specific output without banners", [
    runCliStep(["completion", "bash"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).toContain("_privacy_pools_completion");
      expect(stdout).toContain(
        "complete -o default -F _privacy_pools_completion privacy-pools",
      );
      expect(stdout).not.toContain(
        "complete -o default -F _privacy_pools_completion pp",
      );
    }),
    assertStderr((stderr) => {
      expect(stderr).not.toContain(BANNER_SENTINEL);
    }),
    runCliStep(["completion", "zsh"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).toContain("#compdef privacy-pools");
      expect(stdout).not.toContain("#compdef privacy-pools pp");
      expect(stdout).toContain("compdef _privacy_pools_completion privacy-pools");
    }),
    runCliStep(["completion", "fish"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).toContain("function __fish_privacy_pools_complete");
      expect(stdout).toContain(
        'complete -c privacy-pools -f -a "(__fish_privacy_pools_complete)"',
      );
      expect(stdout).not.toContain("complete -c pp");
    }),
    runCliStep(["completion", "powershell"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).toContain("Register-ArgumentCompleter");
      expect(stdout).toContain("-CommandName privacy-pools");
      expect(stdout).toContain("-ScriptBlock");
      expect(stdout).toContain("completion --query --shell powershell");
      expect(stdout).toContain("CompletionResult");
    }),
  ]),
  defineScenario("machine-readable completion scripts expose shell metadata", [
    runCliStep(["--json", "completion", "powershell"]),
    assertExit(0),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      shell: string;
      completionScript: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("completion-script");
      expect(json.shell).toBe("powershell");
      expect(json.completionScript).toContain("Register-ArgumentCompleter");
      expect(json.completionScript).toContain("-CommandName privacy-pools");
    }),
    runCliStep(["--json", "completion", "zsh"]),
    assertExit(0),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      shell: string;
      completionScript: string;
    }>((json) => {
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("completion-script");
      expect(json.shell).toBe("zsh");
      expect(json.completionScript).toContain(
        "compdef _privacy_pools_completion privacy-pools",
      );
    }),
  ]),
  defineScenario("completion help hides internal query arguments", [
    runCliStep(["completion", "--help"]),
    assertExit(0),
    assertStdout((stdout) => {
      expect(stdout).not.toContain("Internal: shell words for completion query");
      expect(stdout).not.toContain("--query");
      expect(stdout).not.toContain("--cword");
    }),
    assertStderr((stderr) => {
      expect(stderr).not.toContain("Internal: shell words for completion query");
      expect(stderr).not.toContain("--query");
      expect(stderr).not.toContain("--cword");
    }),
  ]),
  defineScenario("query mode returns top-level command candidates", [
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertCompletionLines([
      "init",
      "completion",
      "exit",
      "-j",
      "--json",
      "--agent",
      "--quiet",
      "--verbose",
      "--no-banner",
      "--rpc-url",
    ]),
  ]),
  defineScenario("query mode supports JSON envelopes for agent tooling", [
    runCliStep(
      [
        "--json",
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertJson<{
      mode: string;
      shell: string;
      cword: number;
      candidates: string[];
    }>((json) => {
      expect(json.mode).toBe("completion-query");
      expect(json.shell).toBe("bash");
      expect(json.cword).toBe(1);
      expect(json.candidates).toContain("completion");
      expect(json.candidates).toContain("--json");
    }),
  ]),
  defineScenario("query mode handles unknown binary names gracefully", [
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "unknown-bin",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
  ]),
  defineScenario("query mode suggests flag values and command-specific options", [
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "2",
        "--",
        "privacy-pools",
        "--chain",
        "",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertCompletionLines(["mainnet", "sepolia"]),
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "2",
        "--",
        "privacy-pools",
        "withdraw",
        "",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertCompletionLines(["-p", "--pool-account"]),
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "2",
        "--",
        "privacy-pools",
        "--format",
        "",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertCompletionLines(["table", "csv", "json"]),
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "3",
        "--",
        "privacy-pools",
        "pools",
        "--sort",
        "",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertCompletionLines(["tvl-desc", "asset-asc", "asset-desc"]),
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "3",
        "--",
        "privacy-pools",
        "deposit",
        "--unsigned",
        "",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertCompletionLines(["envelope", "tx"]),
  ]),
  defineScenario("query mode suggests local asset symbols for positional and flag-based asset slots", [
    seedHome("sepolia"),
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "3",
        "--",
        "privacy-pools",
        "deposit",
        "0.1",
        "",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertCompletionLines(["ETH", "USDC", "USDT"]),
    runCliStep(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "5",
        "--",
        "privacy-pools",
        "withdraw",
        "quote",
        "0.1",
        "--asset",
        "",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(0),
    assertCompletionLines(["ETH", "USDC", "USDT"]),
  ]),
  defineScenario("unsupported shells keep human and machine input contracts", [
    runCliStep(["completion", "tcsh"]),
    assertExit(2),
    assertStderr((stderr) => {
      expect(stderr).toContain("Unsupported shell");
    }),
    runCliStep(["--json", "completion", "tcsh"]),
    assertExit(2),
    assertJson<{
      success: boolean;
      error: { category: string; code: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.code).toBe("INPUT_ERROR");
    }),
  ]),
]);
