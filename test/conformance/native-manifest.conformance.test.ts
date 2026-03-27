import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import {
  CHAIN_NAMES,
  MAINNET_CHAIN_NAMES,
} from "../../src/config/chains.ts";
import {
  GENERATED_COMMAND_ALIAS_MAP,
  GENERATED_COMMAND_MANIFEST,
  GENERATED_COMMAND_PATHS,
  GENERATED_COMMAND_ROUTES,
} from "../../src/utils/command-manifest.ts";

const nativeManifestPath = join(
  CLI_ROOT,
  "native",
  "shell",
  "generated",
  "manifest.json",
);
const packageJsonPath = join(CLI_ROOT, "package.json");

describe("native manifest conformance", () => {
  test("generated native manifest stays aligned with the JS manifest contract", () => {
    const nativeManifest = JSON.parse(
      readFileSync(nativeManifestPath, "utf8"),
    ) as {
      manifestVersion: string;
      runtimeVersion: string;
      cliVersion: string;
      commandPaths: string[];
      aliasMap: Record<string, string>;
      structuredRootHelp: string;
      helpTextByPath: Record<string, string>;
      routes: {
        commandRoutes: Record<string, { owner: string; nativeModes: string[] }>;
      };
      runtimeConfig: {
        chainNames: string[];
        mainnetChainNames: string[];
      };
    };
    const pkg = JSON.parse(
      readFileSync(packageJsonPath, "utf8"),
    ) as { version: string };

    expect(nativeManifest.manifestVersion).toBe(
      GENERATED_COMMAND_MANIFEST.manifestVersion,
    );
    expect(nativeManifest.runtimeVersion).toBe(
      GENERATED_COMMAND_MANIFEST.runtimeVersion,
    );
    expect(nativeManifest.cliVersion).toBe(pkg.version);
    expect(nativeManifest.commandPaths).toEqual([...GENERATED_COMMAND_PATHS]);
    expect(nativeManifest.aliasMap).toEqual(GENERATED_COMMAND_ALIAS_MAP);
    expect(nativeManifest.routes.commandRoutes).toEqual(GENERATED_COMMAND_ROUTES);
    expect(Object.keys(nativeManifest.helpTextByPath).sort()).toEqual(
      [...GENERATED_COMMAND_PATHS].sort(),
    );
    expect(nativeManifest.structuredRootHelp).toContain("Usage: privacy-pools");
    expect(nativeManifest.runtimeConfig.chainNames).toEqual(CHAIN_NAMES);
    expect(nativeManifest.runtimeConfig.mainnetChainNames).toEqual(
      MAINNET_CHAIN_NAMES,
    );
  });
});
