import { describe, expect, test } from "bun:test";
import {
  detectCompletionShell,
  isCompletionShell,
  queryCompletionCandidates,
  STATIC_COMPLETION_SPEC,
  type CompletionCommandSpec,
} from "../../src/utils/completion-query.ts";

describe("completion query helpers", () => {
  test("detects supported shells and falls back to bash", () => {
    expect(isCompletionShell("bash")).toBe(true);
    expect(isCompletionShell("zsh")).toBe(true);
    expect(isCompletionShell("fish")).toBe(true);
    expect(isCompletionShell("powershell")).toBe(true);
    expect(isCompletionShell("tcsh")).toBe(false);

    expect(detectCompletionShell("/bin/zsh")).toBe("zsh");
    expect(detectCompletionShell("/opt/homebrew/bin/fish")).toBe("fish");
    expect(detectCompletionShell("/bin/bash")).toBe("bash");
    expect(detectCompletionShell("")).toBe("bash");
  });

  test("suggests top-level commands and global flags", () => {
    const candidates = queryCompletionCandidates(["privacy-pools"], 1);

    expect(candidates).toContain("flow");
    expect(candidates).toContain("withdraw");
    expect(candidates).toContain("--chain");
    expect(candidates).toContain("--agent");
  });

  test("suggests flow subcommands with prefix filtering", () => {
    const candidates = queryCompletionCandidates(["privacy-pools", "flow", "st"], 2);

    expect(candidates).toEqual(["start", "status"]);
  });

  test("suggests option values after value-taking flags", () => {
    expect(
      queryCompletionCandidates(["privacy-pools", "--chain", ""], 2),
    ).toEqual(expect.arrayContaining(["mainnet", "sepolia"]));

    expect(
      queryCompletionCandidates(["privacy-pools", "--format=j"], 1),
    ).toEqual(["--format=json"]);

    expect(
      queryCompletionCandidates(
        ["privacy-pools", "flow", "start", "0.1", "ETH", "--privacy-delay", ""],
        6,
      ),
    ).toEqual(["aggressive", "balanced", "off"]);
  });

  test("returns no candidates when a free-form option value is expected", () => {
    expect(
      queryCompletionCandidates(["privacy-pools", "--rpc-url", ""], 2),
    ).toEqual([]);
  });

  test("normalizes alternate binary names and custom specs", () => {
    const customSpec: CompletionCommandSpec = {
      name: "custom-cli",
      aliases: ["cc"],
      options: [{ names: ["--region"], takesValue: true, values: ["us", "eu"] }],
      subcommands: [
        {
          name: "deploy",
          aliases: ["ship"],
          options: [{ names: ["--env"], takesValue: true, values: ["dev", "prod"] }],
          subcommands: [],
        },
      ],
    };

    const valueCandidates = queryCompletionCandidates(
      ["custom-cli", "ship", "--env", ""],
      3,
      customSpec,
    );
    expect(valueCandidates).toEqual(["dev", "prod"]);

    const rootCandidates = queryCompletionCandidates(["custom-cli"], 1, customSpec);
    expect(rootCandidates).toContain("deploy");
    expect(rootCandidates).toContain("ship");
    expect(rootCandidates).toContain("--region");
  });

  test("static completion spec stays rooted at privacy-pools", () => {
    expect(STATIC_COMPLETION_SPEC.name).toBe("privacy-pools");
    expect(
      STATIC_COMPLETION_SPEC.subcommands?.find((subcommand) => subcommand.name === "flow"),
    ).toBeDefined();
  });
});
