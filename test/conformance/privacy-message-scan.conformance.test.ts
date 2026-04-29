import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

const FULL_ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/;
const FULL_ETH_AMOUNT_PATTERN = /\b[0-9]+(?:\.[0-9]+)? ETH\b/;
const USER_MESSAGE_PATTERN = /new CLIError|hint:|message:|warn\(|diagnostic|backup/i;
// Example-only amount literals are allowed when the line is explicitly marked
// as an example. This currently covers command guidance such as
// src/commands/withdraw.ts and src/runtime/cli-main-helpers.ts, where the
// amount is illustrative rather than user/private state.
const EXAMPLE_PATTERN = /\bExample:/;

const SKIPPED_RUNTIME_SOURCES: Record<string, string> = {
  "src/utils/command-catalog.ts":
    "reviewed help/example source; contains intentionally illustrative command examples such as 0.1 ETH",
  "src/utils/command-manifest.ts":
    "generated discovery output; source literals are audited in the generator inputs",
  "src/utils/help.ts":
    "reviewed root/help prose; contains intentionally illustrative command examples such as 0.1 ETH",
  "src/utils/known-addresses.ts":
    "canonical address-book source; sentinel literals must live here",
  "src/utils/root-help-footer.ts":
    "reviewed root-help footer examples; contains intentionally illustrative command examples such as 0.1 ETH",
};

function walkFiles(root: string, extensions: readonly string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walkFiles(path, extensions));
    } else if (extensions.some((extension) => path.endsWith(extension))) {
      files.push(path);
    }
  }
  return files;
}

function scanRuntimeMessageSources(): string[] {
  return [
    ...walkFiles(join(CLI_ROOT, "src", "commands"), [".ts"]),
    ...walkFiles(join(CLI_ROOT, "src", "runtime"), [".ts"]),
    ...walkFiles(join(CLI_ROOT, "src", "services"), [".ts"]),
    ...walkFiles(join(CLI_ROOT, "src", "utils"), [".ts"]),
    join(CLI_ROOT, "src", "launcher.ts"),
    join(CLI_ROOT, "scripts", "lib", "install-verification.mjs"),
  ].filter((file) => !(relative(CLI_ROOT, file) in SKIPPED_RUNTIME_SOURCES));
}

describe("privacy message scan", () => {
  test("user-facing diagnostics avoid full address and ETH amount literals", () => {
    const offenders: string[] = [];

    for (const file of scanRuntimeMessageSources()) {
      const relPath = relative(CLI_ROOT, file);
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (FULL_ADDRESS_PATTERN.test(line)) {
          offenders.push(`${relPath}:${index + 1} contains a full address literal`);
        }
        if (
          USER_MESSAGE_PATTERN.test(line) &&
          FULL_ETH_AMOUNT_PATTERN.test(line) &&
          !EXAMPLE_PATTERN.test(line)
        ) {
          offenders.push(`${relPath}:${index + 1} contains a full ETH amount literal`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  test("high-stakes withdrawal confirmations keep full destination addresses", () => {
    const withdrawSource = readFileSync(
      join(CLI_ROOT, "src", "commands", "withdraw.ts"),
      "utf8",
    );

    expect(withdrawSource).toContain("Recipient: ${directAddress}");
    expect(withdrawSource).toContain("to ${resolvedRecipientAddress}");
    expect(withdrawSource).not.toContain("Recipient: ${formatAddress(directAddress)}");
    expect(withdrawSource).not.toContain("to ${formatAddress(resolvedRecipientAddress)}");
  });
});
