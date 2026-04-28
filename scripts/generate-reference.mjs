/**
 * Generate docs/reference.md from the Commander tree + canonical command catalog.
 *
 * Usage:
 *   node scripts/generate-reference.mjs          # preview to stdout
 *   node scripts/generate-reference.mjs --write   # write to docs/reference.md
 *   node scripts/generate-reference.mjs --check   # compare with docs/reference.md, exit 1 on drift
 *
 * Requires a prior build (`npm run build`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

// ── Guard: dist/ must exist ──

const distPath = join(repoRoot, "dist", "program.js");
if (!existsSync(distPath)) {
  console.error(
    "Built CLI not found. Run `npm run build` first, or use `npm run dev -- ...` from source.",
  );
  process.exit(1);
}

// ── Imports from built artifacts ──

const { createRootProgram } = await import(join(repoRoot, "dist", "program.js"));
const {
  CAPABILITY_EXIT_CODES,
  CAPABILITIES_COMMAND_ORDER,
  GLOBAL_FLAG_METADATA,
} = await import(join(repoRoot, "dist", "utils", "command-metadata.js"));
const { COMMAND_CATALOG } = await import(join(repoRoot, "dist", "utils", "command-catalog.js"));
const {
  ROOT_COMMAND_DESCRIPTIONS,
  ROOT_COMMAND_GROUPS,
} = await import(join(repoRoot, "dist", "utils", "root-command-groups.js"));

// ── Build Commander tree for flag descriptions ──

const program = await createRootProgram("0.0.0");

/** Build a name→Command map including subcommands (space-separated paths). */
function buildCommandMap(cmd, prefix = "") {
  const map = new Map();
  for (const sub of cmd.commands) {
    const path = prefix ? `${prefix} ${sub.name()}` : sub.name();
    map.set(path, sub);
    // Recurse for subcommands (e.g., "stats global", "withdraw quote")
    buildCommandMap(sub, path).forEach((v, k) => map.set(k, v));
  }
  return map;
}

const commandMap = buildCommandMap(program);

// ── Helpers ──

function escapeMarkdownPipe(str) {
  return str.replace(/\|/g, "\\|");
}

function getCommandOptions(cmd, capabilityFlags) {
  // Build a set of flag names from capabilities metadata to include
  // hidden options that are documented in the command's capabilities.
  const capFlagNames = new Set();
  if (capabilityFlags) {
    for (const f of capabilityFlags) {
      const match = f.match(/^(--[\w-]+)/);
      if (match) capFlagNames.add(match[1]);
    }
  }

  const opts = [];
  for (const opt of cmd.options) {
    if (opt.long === "--help" || opt.long === "--version") continue;
    // Include visible options, plus hidden ones documented in capabilities
    if (opt.hidden && !(opt.long && capFlagNames.has(opt.long))) continue;
    const flags = opt.flags;
    const desc = opt.description || "";
    opts.push({ flags, description: desc });
  }
  return opts;
}

function rootCommandForPath(path) {
  return path.split(" ")[0];
}

function renderCommandSection(path, headingLevel = "##") {
  const metadata = COMMAND_CATALOG[path];
  if (!metadata) return [];

  const cmd = commandMap.get(path);
  if (!cmd) return [];

  const section = [];
  section.push("");
  section.push(`${headingLevel} \`${path}\``);
  section.push("");
  section.push(metadata.description);

  const cmdArgs = cmd.registeredArguments || [];
  if (cmdArgs.length > 0) {
    const argSyntax = cmdArgs
      .map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
      .join(" ");
    section.push("");
    section.push(`**Usage:** \`privacy-pools ${path} ${argSyntax} [options]\``);
  }

  const overview = metadata.help?.overview ?? [];
  if (overview.length > 0) {
    const filtered = overview.filter(
      (line) => !(line.startsWith("  ") && line.includes("privacy-pools"))
    );
    while (
      filtered.length > 0 &&
      filtered[filtered.length - 1].trim().endsWith(":")
    ) {
      filtered.pop();
    }
    const hasContent = filtered.some((line) => line.trim().length > 0);
    if (hasContent) {
      const hasIndented = filtered.some((line) => line.startsWith("  ") && line.trim().length > 0);
      section.push("");
      if (hasIndented) {
        for (const line of filtered.filter((line) => line.trim().length > 0)) {
          section.push(`> ${line}`);
        }
      } else {
        const paragraphs = [];
        let current = [];
        for (const line of filtered) {
          if (line.trim().length === 0) {
            if (current.length > 0) {
              paragraphs.push(current.join(" "));
              current = [];
            }
          } else {
            current.push(line);
          }
        }
        if (current.length > 0) {
          paragraphs.push(current.join(" "));
        }
        section.push(paragraphs.join("\n\n"));
      }
    }
  }

  const examples = metadata.help?.examples ?? [];
  if (examples.length > 0) {
    section.push("");
    const hasCategories = examples.some((ex) => typeof ex !== "string");
    if (hasCategories) {
      for (const ex of examples) {
        if (typeof ex === "string") {
          section.push("```bash");
          section.push(ex);
          section.push("```");
        } else {
          section.push(`**${ex.category}:**`);
          section.push("");
          section.push("```bash");
          for (const command of ex.commands) {
            section.push(command);
          }
          section.push("```");
          section.push("");
        }
      }
    } else {
      section.push("```bash");
      for (const ex of examples) {
        section.push(ex);
      }
      section.push("```");
    }
  }

  const options = getCommandOptions(cmd, metadata.capabilities?.flags);
  if (options.length > 0) {
    section.push("");
    section.push("| Flag | Description |");
    section.push("|------|-------------|");
    for (const opt of options) {
      section.push(`| \`${escapeMarkdownPipe(opt.flags)}\` | ${escapeMarkdownPipe(opt.description)} |`);
    }
  }

  const safetyNotes = metadata.help?.safetyNotes ?? [];
  if (safetyNotes.length > 0) {
    section.push("");
    for (const note of safetyNotes) {
      section.push(`**Safety:** ${note}`);
    }
  }

  const jsonFields = metadata.help?.jsonFields;
  if (jsonFields) {
    section.push("");
    section.push(`**JSON output:** \`${jsonFields}\``);
  }

  const jsonVariants = metadata.help?.jsonVariants ?? [];
  if (jsonVariants.length > 0) {
    section.push("");
    section.push("**JSON variants:**");
    for (const variant of jsonVariants) {
      section.push(`- \`${variant}\``);
    }
  }

  return section;
}

// ── Generate markdown ──

const commandPathsByRoot = new Map();
for (const path of CAPABILITIES_COMMAND_ORDER) {
  const root = rootCommandForPath(path);
  const paths = commandPathsByRoot.get(root) ?? [];
  paths.push(path);
  commandPathsByRoot.set(root, paths);
}

const rootCommandNames = ROOT_COMMAND_GROUPS.flatMap((group) => group.commands)
  .filter((command) => commandPathsByRoot.has(command));
const manCommandOrder = ROOT_COMMAND_GROUPS.flatMap((group) =>
  group.commands.flatMap((command) => {
    const commandPaths = commandPathsByRoot.get(command);
    if (commandPaths?.length) return commandPaths;
    return commandMap.has(command) && COMMAND_CATALOG[command] ? [command] : [];
  }),
);

const lines = [];

lines.push("<!-- AUTO-GENERATED by scripts/generate-reference.mjs - DO NOT EDIT -->");
lines.push("");
lines.push("# CLI Reference");
lines.push("");
lines.push("Command-family index for the Privacy Pools CLI. For a quick overview, see the [README](../README.md). For agent integration, see [AGENTS.md](../AGENTS.md).");
lines.push("");
lines.push("## Command Families");
for (const group of ROOT_COMMAND_GROUPS) {
  const commands = group.commands.filter((command) => commandPathsByRoot.has(command));
  if (commands.length === 0) continue;
  lines.push("");
  lines.push(`### ${group.heading}`);
  lines.push("");
  for (const command of commands) {
    lines.push(
      `- [\`${command}\`](reference/${command}.md) - ${ROOT_COMMAND_DESCRIPTIONS[command]}`,
    );
  }
}

// ── Global Flags ──

lines.push("");
lines.push("## Global Flags");
lines.push("");
lines.push("| Flag | Description |");
lines.push("|------|-------------|");
for (const { flag, description } of GLOBAL_FLAG_METADATA) {
  lines.push(`| \`${escapeMarkdownPipe(flag)}\` | ${escapeMarkdownPipe(description)} |`);
}

// ── Exit Codes ──

if (CAPABILITY_EXIT_CODES?.length) {
  lines.push("");
  lines.push("## Exit Codes");
  lines.push("");
  lines.push("| Code | Category | Error Code | Meaning |");
  lines.push("|------|----------|------------|---------|");

  for (const exitCode of CAPABILITY_EXIT_CODES) {
    lines.push(
      `| ${exitCode.code} | ${exitCode.category} | \`${escapeMarkdownPipe(exitCode.errorCode)}\` | ${escapeMarkdownPipe(exitCode.description)} |`,
    );
  }
}

// ── Static sections ──

const staticPath = join(repoRoot, "docs", "reference-static-sections.md");
if (existsSync(staticPath)) {
  lines.push("");
  lines.push(readFileSync(staticPath, "utf8").trimEnd());
}

lines.push("");

const output = lines.join("\n");

const shardOutputs = new Map();
for (const rootCommand of rootCommandNames) {
  const shardLines = [];
  shardLines.push("<!-- AUTO-GENERATED by scripts/generate-reference.mjs - DO NOT EDIT -->");
  shardLines.push("");
  shardLines.push(`# CLI Reference: \`${rootCommand}\``);
  shardLines.push("");
  shardLines.push(
    `Detailed reference for the \`privacy-pools ${rootCommand}\` command family. Back to the [index](../reference.md).`,
  );

  const familyPaths = commandPathsByRoot.get(rootCommand) ?? [];
  for (const path of familyPaths) {
    shardLines.push(...renderCommandSection(path, "##"));
  }
  shardLines.push("");
  shardOutputs.set(rootCommand, shardLines.join("\n"));
}

// ── Generate man page ──

function escapeTroff(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/^([.'"])/gm, "\\&$1")
    .replace(/-/g, "\\-");
}

function inlineCodeToBold(value) {
  return escapeTroff(value).replace(/`([^`]+)`/g, "\\fB$1\\fR");
}

function commandSynopsis(path, cmd) {
  const args = (cmd.registeredArguments || [])
    .map((arg) => (arg.required ? `<${arg.name()}>` : `[${arg.name()}]`))
    .join(" ");
  return `privacy-pools ${path}${args ? ` ${args}` : ""} [options]`;
}

function buildManPage() {
  const man = [];
  man.push(".TH PRIVACY-POOLS 1");
  man.push(".SH NAME");
  man.push("privacy-pools \\- interact with Privacy Pools v1");
  man.push(".SH SYNOPSIS");
  man.push(".B privacy-pools");
  man.push("[options] [command]");
  man.push(".SH DESCRIPTION");
  man.push(inlineCodeToBold("Privacy Pools CLI provides public deposits, private relayed withdrawals, ragequit recovery, account sync, and agent-friendly JSON discovery."));
  man.push(".SH COMMANDS");
  for (const path of manCommandOrder) {
    const metadata = COMMAND_CATALOG[path];
    const cmd = commandMap.get(path);
    if (!metadata || !cmd) continue;
    man.push(".TP");
    man.push(`.B ${escapeTroff(path)}`);
    man.push(inlineCodeToBold(metadata.description));
    man.push(".br");
    man.push(`Usage: \\fB${escapeTroff(commandSynopsis(path, cmd))}\\fR`);
  }
  man.push(".SH GLOBAL OPTIONS");
  for (const { flag, description } of GLOBAL_FLAG_METADATA) {
    man.push(".TP");
    man.push(`.B ${escapeTroff(flag)}`);
    man.push(inlineCodeToBold(description));
  }
  man.push(".SH ENVIRONMENT");
  man.push(".TP");
  man.push(".B PRIVACY_POOLS_HOME, PRIVACY_POOLS_CONFIG_DIR");
  man.push("Override the CLI config directory.");
  man.push(".TP");
  man.push(".B XDG_CONFIG_HOME");
  man.push("Fallback config base used as $XDG_CONFIG_HOME/privacy-pools when no Privacy Pools override is set and no legacy ~/.privacy-pools directory exists.");
  man.push(".TP");
  man.push(".B PRIVACY_POOLS_PRIVATE_KEY");
  man.push("Signer private key. Takes precedence over the saved .signer file.");
  man.push(".SH FILES");
  man.push(".TP");
  man.push(".B ~/.privacy-pools/");
  man.push("Default configuration directory, unless an override or eligible XDG fallback is used.");
  man.push(".SH SEE ALSO");
  man.push("privacy-pools guide, privacy-pools capabilities, privacy-pools describe");
  man.push("");
  return man.join("\n");
}

const manOutput = buildManPage();

// ── Mode dispatch ──

const args = process.argv.slice(2);

if (args.includes("--write")) {
  const outPath = join(repoRoot, "docs", "reference.md");
  writeFileSync(outPath, output);
  const shardDir = join(repoRoot, "docs", "reference");
  mkdirSync(shardDir, { recursive: true });
  for (const [rootCommand, shardOutput] of shardOutputs.entries()) {
    const shardPath = join(shardDir, `${rootCommand}.md`);
    writeFileSync(shardPath, shardOutput);
    console.log(`Wrote ${shardPath}`);
  }
  const manPath = join(repoRoot, "docs", "man", "privacy-pools.1");
  mkdirSync(dirname(manPath), { recursive: true });
  writeFileSync(manPath, manOutput);
  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${manPath}`);
} else if (args.includes("--check")) {
  const refPath = join(repoRoot, "docs", "reference.md");
  if (!existsSync(refPath)) {
    console.error(`${refPath} not found.`);
    process.exit(1);
  }
  const current = readFileSync(refPath, "utf8");
  if (current !== output) {
    console.error("docs/reference.md is out of date. Run `npm run docs:generate` to regenerate.");
    process.exit(1);
  }
  for (const [rootCommand, shardOutput] of shardOutputs.entries()) {
    const shardPath = join(repoRoot, "docs", "reference", `${rootCommand}.md`);
    if (!existsSync(shardPath)) {
      console.error(`${shardPath} not found. Run \`npm run docs:generate\` to regenerate.`);
      process.exit(1);
    }
    const currentShard = readFileSync(shardPath, "utf8");
    if (currentShard !== shardOutput) {
      console.error(`${shardPath} is out of date. Run \`npm run docs:generate\` to regenerate.`);
      process.exit(1);
    }
  }
  const manPath = join(repoRoot, "docs", "man", "privacy-pools.1");
  if (!existsSync(manPath)) {
    console.error(`${manPath} not found. Run \`npm run docs:generate\` to regenerate.`);
    process.exit(1);
  }
  const currentMan = readFileSync(manPath, "utf8");
  if (currentMan !== manOutput) {
    console.error("docs/man/privacy-pools.1 is out of date. Run `npm run docs:generate` to regenerate.");
    process.exit(1);
  }
  console.log("docs/reference.md is up to date.");
} else {
  process.stdout.write(output);
}
