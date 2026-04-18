import { describe, expect, test } from "bun:test";
import { Command, Option } from "commander";
import {
  buildCompletionSpecFromCommand,
  renderCompletionScript,
} from "../../src/utils/completion.ts";

describe("completion script helpers", () => {
  test("builds specs from commander commands without internal completion flags", () => {
    const command = new Command("privacy-pools")
      .option("--query")
      .option("--cword <n>")
      .option("-c, --chain <name>")
      .addOption(new Option("--output <fmt>").choices(["table", "json"]))
      .command("sync")
      .option("--default-chain <chain>")
      .parent!;

    const spec = buildCompletionSpecFromCommand(command);
    const optionNames = spec.options?.flatMap((option) => option.names) ?? [];

    expect(optionNames).toContain("--chain");
    expect(optionNames).toContain("-c");
    expect(optionNames).toContain("--output");
    expect(optionNames).not.toContain("--query");
    expect(optionNames).not.toContain("--cword");

    const chainOption = spec.options?.find((option) => option.names.includes("--chain"));
    expect(chainOption?.values).toEqual(expect.arrayContaining(["mainnet", "sepolia"]));

    const formatOption = spec.options?.find((option) => option.names.includes("--output"));
    expect(formatOption?.values).toEqual(["json", "table"]);

    const sync = spec.subcommands?.find((subcommand) => subcommand.name === "sync");
    const defaultChainOption = sync?.options?.find((option) =>
      option.names.includes("--default-chain"),
    );
    expect(defaultChainOption?.values).toEqual(
      expect.arrayContaining(["mainnet", "op-sepolia"]),
    );
  });

  test("renders bash completion scripts for all registered command names", () => {
    const script = renderCompletionScript("bash", ["privacy-pools", "pp"]);

    expect(script).toContain("_privacy_pools_completion");
    expect(script).toContain(
      "complete -o default -F _privacy_pools_completion privacy-pools",
    );
    expect(script).toContain("complete -o default -F _privacy_pools_completion pp");
  });

  test("renders zsh completion scripts", () => {
    const script = renderCompletionScript("zsh", ["privacy-pools", "pp"]);

    expect(script).toContain("#compdef privacy-pools pp");
    expect(script).toContain("compdef _privacy_pools_completion privacy-pools pp");
  });

  test("renders fish completion scripts", () => {
    const script = renderCompletionScript("fish", ["privacy-pools", "pp"]);

    expect(script).toContain("function __fish_privacy_pools_complete");
    expect(script).toContain('complete -c privacy-pools -f -a "(__fish_privacy_pools_complete)"');
    expect(script).toContain('complete -c pp -f -a "(__fish_privacy_pools_complete)"');
  });

  test("renders powershell completion scripts", () => {
    const script = renderCompletionScript("powershell", ["privacy-pools", "pp"]);

    expect(script).toContain("Register-ArgumentCompleter -CommandName privacy-pools");
    expect(script).toContain("Register-ArgumentCompleter -CommandName pp");
    expect(script).toContain("[System.Management.Automation.CompletionResult]");
  });
});
