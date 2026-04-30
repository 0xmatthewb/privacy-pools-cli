import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const outputPath = join(repoRoot, "docs", "errors.md");
const mode = process.argv.includes("--check") ? "check" : "write";

const { ERROR_CODE_REGISTRY, errorDocUrl } = await import(
  pathToFileURL(join(repoRoot, "dist", "utils", "error-code-registry.js")).href
);

function inferCategory(code) {
  if (ERROR_CODE_REGISTRY[code]) return ERROR_CODE_REGISTRY[code].category;
  if (code === "PROMPT_CANCELLED") return "CANCELLED";
  if (code.startsWith("INPUT_") || code.startsWith("ACCOUNT_")) return "INPUT";
  if (code.startsWith("SETUP_")) return "SETUP";
  if (code.startsWith("RPC_")) return "RPC";
  if (code.startsWith("ASP_")) return "ASP";
  if (code.startsWith("RELAYER_")) return "RELAYER";
  if (code.startsWith("PROOF_")) return "PROOF";
  if (code.startsWith("CONTRACT_")) return "CONTRACT";
  return "UNKNOWN";
}

function inferRetryable(code) {
  return ERROR_CODE_REGISTRY[code]?.retryable ?? false;
}

function discoverSourceCodes() {
  const files = execFileSync("git", ["ls-files", "src", "native/shell/src"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file.endsWith(".ts") || file.endsWith(".rs"));
  const codes = new Set(Object.keys(ERROR_CODE_REGISTRY));
  const codePattern = /["']([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)["']/g;
  const errorPrefixes = [
    "ACCOUNT_",
    "ASP_",
    "COMMAND_",
    "CONTRACT_",
    "INPUT_",
    "PROMPT_",
    "PROOF_",
    "RELAYER_",
    "RPC_",
    "SETUP_",
    "UNKNOWN_",
  ];
  for (const file of files) {
    const sourcePath = join(repoRoot, file);
    if (!existsSync(sourcePath)) continue;
    const text = readFileSync(sourcePath, "utf8");
    for (const match of text.matchAll(codePattern)) {
      const code = match[1];
      if (errorPrefixes.some((prefix) => code.startsWith(prefix))) {
        codes.add(code);
      }
    }
  }
  return [...codes].sort((a, b) => a.localeCompare(b));
}

const errorCodes = discoverSourceCodes();
const ERROR_CODE_NOTES = {
  CONTRACT_ERROR:
    "For ERC-20 deposit failures, `error.details.approvalTxHash` may be non-null. That indicates the approval transaction may have succeeded while the deposit failed; inspect the approval transaction, then reset allowance or retry the deposit.",
};

const lines = [
  "# Privacy Pools CLI Error Codes",
  "",
  "This file is generated from `src/utils/error-code-registry.ts` plus error-code literals in `src/` and `native/shell/src/`. Each heading is a stable target for `error.docUrl` in JSON error envelopes.",
  "",
  "| Code | Category | Retryable |",
  "| --- | --- | --- |",
];

for (const code of errorCodes) {
  lines.push(`| [\`${code}\`](${errorDocUrl(code)}) | ${inferCategory(code)} | ${inferRetryable(code) ? "yes" : "no"} |`);
}

lines.push("");
for (const code of errorCodes) {
  lines.push(`## ${code}`);
  lines.push("");
  lines.push(`- Category: \`${inferCategory(code)}\``);
  lines.push(`- Retryable: \`${inferRetryable(code) ? "true" : "false"}\``);
  lines.push(`- Stable URL: ${errorDocUrl(code)}`);
  if (ERROR_CODE_NOTES[code]) {
    lines.push(`- Note: ${ERROR_CODE_NOTES[code]}`);
  }
  lines.push("");
}

const content = `${lines.join("\n").trimEnd()}\n`;

if (mode === "write") {
  writeFileSync(outputPath, content);
  console.log(`Wrote ${outputPath}`);
} else {
  const existing = readFileSync(outputPath, "utf8");
  if (existing !== content) {
    console.error("docs/errors.md is out of date.");
    process.exit(1);
  }
  console.log("docs/errors.md is up to date.");
}
