import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const schemasDir = join(repoRoot, "schemas");
const mode = process.argv.includes("--check") ? "check" : "write";

const { commandEnvelopeSchemas } = await import(
  pathToFileURL(join(repoRoot, "dist", "types", "envelopes", "commands.js")).href
);

function schemaFileName(command) {
  return `${command.replace(/\s+/g, ".")}.schema.json`;
}

function renderSchema(command, schema) {
  return `${JSON.stringify(
    zodToJsonSchema(schema, {
      name: `${command} envelope`,
      target: "jsonSchema7",
    }),
    null,
    2,
  )}\n`;
}

const generated = Object.entries(commandEnvelopeSchemas).map(([command, schema]) => ({
  command,
  fileName: schemaFileName(command),
  content: renderSchema(command, schema),
}));

const index = `${JSON.stringify(
  {
    generatedFrom: "src/types/envelopes/commands.ts",
    commands: generated.map(({ command, fileName }) => ({
      command,
      schema: `schemas/${fileName}`,
    })),
  },
  null,
  2,
)}\n`;

if (mode === "write") {
  rmSync(schemasDir, { recursive: true, force: true });
  mkdirSync(schemasDir, { recursive: true });
  for (const { fileName, content } of generated) {
    writeFileSync(join(schemasDir, fileName), content);
  }
  writeFileSync(join(schemasDir, "index.json"), index);
  console.log(`Wrote ${generated.length} envelope schemas to ${schemasDir}`);
} else {
  const mismatches = [];
  const expectedFiles = new Set(["index.json", ...generated.map(({ fileName }) => fileName)]);
  for (const { fileName, content } of generated) {
    const path = join(schemasDir, fileName);
    let existing = "";
    try {
      existing = readFileSync(path, "utf8");
    } catch {
      mismatches.push(path);
      continue;
    }
    if (existing !== content) {
      mismatches.push(path);
    }
  }
  try {
    if (readFileSync(join(schemasDir, "index.json"), "utf8") !== index) {
      mismatches.push(join(schemasDir, "index.json"));
    }
  } catch {
    mismatches.push(join(schemasDir, "index.json"));
  }
  try {
    for (const fileName of readdirSync(schemasDir)) {
      if (!expectedFiles.has(fileName)) {
        mismatches.push(join(schemasDir, fileName));
      }
    }
  } catch {
    mismatches.push(schemasDir);
  }

  if (mismatches.length > 0) {
    console.error(`Envelope schemas are out of date:\n${mismatches.join("\n")}`);
    process.exit(1);
  }
  console.log("Envelope schemas are up to date.");
}
