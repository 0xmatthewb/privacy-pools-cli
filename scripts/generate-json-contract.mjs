import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const contractPaths = [
  join(repoRoot, "docs", "contracts", "cli-json-contract.current.json"),
  join(repoRoot, "docs", "contracts", "cli-json-contract.v2.0.0.json"),
];

const { commandEnvelopeSchemas } = await import(
  pathToFileURL(join(repoRoot, "dist", "types", "envelopes", "commands.js")).href
);

function resolveJsonPointer(root, pointer) {
  if (!pointer.startsWith("#/")) return undefined;
  return pointer
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((value, key) => value?.[key], root);
}

function dereference(root, schema) {
  if (!schema || typeof schema !== "object" || typeof schema.$ref !== "string") {
    return schema;
  }
  return resolveJsonPointer(root, schema.$ref) ?? schema;
}

function typeSummary(schema, root = schema) {
  schema = dereference(root, schema);
  if (!schema || typeof schema !== "object") return "unknown";
  if (typeof schema.const !== "undefined") return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join("|");
  }
  if (Array.isArray(schema.type)) return schema.type.join("|");
  if (typeof schema.type === "string") {
    if (schema.type === "array") {
      return `array<${typeSummary(schema.items, root)}>`;
    }
    if (schema.type === "object") {
      const keys = Object.keys(schema.properties ?? {});
      return keys.length > 0 ? `object{${keys.join(",")}}` : "object";
    }
    return schema.type;
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map((item) => typeSummary(item, root)).join("|");
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((item) => typeSummary(item, root)).join("|");
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.map((item) => typeSummary(item, root)).join("&");
  }
  return "unknown";
}

function collectProperties(schema, root, result = {}) {
  schema = dereference(root, schema);
  if (!schema || typeof schema !== "object") return result;
  if (schema.properties && typeof schema.properties === "object") {
    Object.assign(result, schema.properties);
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (!Array.isArray(schema[key])) continue;
    for (const item of schema[key]) {
      collectProperties(item, root, result);
    }
  }
  return result;
}

function collectRequired(schema, root, result = new Set()) {
  schema = dereference(root, schema);
  if (!schema || typeof schema !== "object") return result;
  for (const field of schema.required ?? []) {
    result.add(field);
  }
  if (Array.isArray(schema.allOf)) {
    for (const item of schema.allOf) {
      collectRequired(item, root, result);
    }
  }
  return result;
}

function successPayloadContract(command, schema) {
  const jsonSchema = zodToJsonSchema(schema, {
    name: `${command} envelope`,
    target: "jsonSchema7",
  });
  const definition = jsonSchema.definitions?.[`${command} envelope`];
  const successVariant = definition?.anyOf?.[0];
  const payloadSchema = successVariant?.allOf?.[1] ?? { properties: {}, required: [] };
  return {
    properties: collectProperties(payloadSchema, jsonSchema),
    required: [...collectRequired(payloadSchema, jsonSchema)],
    root: jsonSchema,
  };
}

export function generateJsonContractSection() {
  const commands = {};
  for (const [command, schema] of Object.entries(commandEnvelopeSchemas)) {
    const payloadSchema = successPayloadContract(command, schema);
    const properties = payloadSchema.properties ?? {};
    commands[command] = {
      successFields: Object.fromEntries(
        Object.entries(properties)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([field, fieldSchema]) => [
            field,
            typeSummary(fieldSchema, payloadSchema.root),
          ]),
      ),
      requiredSuccessFields: [...(payloadSchema.required ?? [])].sort(),
      variants: ["success", "error"],
    };
  }

  return {
    marker: "AUTO-GENERATED: run npm run docs:generate to update",
    generatedFrom: "src/types/envelopes/commands.ts",
    commands,
  };
}

export function renderJsonContractDoc(doc, generated = generateJsonContractSection()) {
  return `${JSON.stringify({ ...doc, generated }, null, 2)}\n`;
}

async function main() {
  const mode = process.argv.includes("--check") ? "check" : "write";
  const generated = generateJsonContractSection();
  const mismatches = [];

  for (const contractPath of contractPaths) {
    const doc = JSON.parse(readFileSync(contractPath, "utf8"));
    const rendered = renderJsonContractDoc(doc, generated);

    if (mode === "write") {
      writeFileSync(contractPath, rendered);
      continue;
    }

    if (readFileSync(contractPath, "utf8") !== rendered) {
      mismatches.push(contractPath);
    }
  }

  if (mode === "check") {
    if (mismatches.length > 0) {
      console.error(
        `JSON contract docs are out of date. Run \`npm run docs:generate\`.\n${mismatches.join("\n")}`,
      );
      process.exit(1);
    }
    console.log("JSON contract docs are up to date.");
  } else {
    console.log(`Wrote generated JSON contract section to ${contractPaths.length} files.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
