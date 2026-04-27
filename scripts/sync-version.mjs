#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const packagePath = resolve(repoRoot, "package.json");
const versionPath = resolve(repoRoot, "version.txt");
const cargoPath = resolve(repoRoot, "native/shell/Cargo.toml");

const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const version = String(packageJson.version ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`package.json has an invalid version: ${version || "<missing>"}`);
}

writeFileSync(versionPath, `${version}\n`);

const cargoToml = readFileSync(cargoPath, "utf8");
writeFileSync(
  cargoPath,
  cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`),
);

for (const dependencyBlock of ["optionalDependencies"]) {
  const dependencies = packageJson[dependencyBlock];
  if (!dependencies || typeof dependencies !== "object") continue;
  for (const name of Object.keys(dependencies)) {
    if (name.startsWith("@0xmatthewb/privacy-pools-cli-native-")) {
      dependencies[name] = version;
    }
  }
}

writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
