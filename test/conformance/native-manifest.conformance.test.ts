import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import {
  CHAIN_NAMES,
  MAINNET_CHAIN_NAMES,
} from "../../src/config/chains.ts";
import { createTempHome, runCli } from "../helpers/cli.ts";
import {
  GENERATED_COMMAND_ALIAS_MAP,
  GENERATED_COMMAND_MANIFEST,
  GENERATED_COMMAND_PATHS,
  GENERATED_COMMAND_ROUTES,
} from "../../src/utils/command-manifest.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

const nativeManifestPath = join(
  CLI_ROOT,
  "native",
  "shell",
  "generated",
  "manifest.json",
);
const packageJsonPath = join(CLI_ROOT, "package.json");
const versionTxtPath = join(CLI_ROOT, "version.txt");
const cargoTomlPath = join(CLI_ROOT, "native", "shell", "Cargo.toml");

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

describe("native manifest conformance", () => {
  test("generated native manifest stays aligned with the JS manifest contract", () => {
    const nativeManifest = JSON.parse(
      readFileSync(nativeManifestPath, "utf8"),
    ) as {
      manifestVersion: string;
      runtimeVersion: string;
      cliVersion: string;
      jsonSchemaVersion: string;
      commandPaths: string[];
      aliasMap: Record<string, string>;
      structuredRootHelp: string;
      guideHumanText: string;
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
    const versionTxt = readFileSync(versionTxtPath, "utf8").trim();
    const cargoToml = readFileSync(cargoTomlPath, "utf8");
    const cargoVersion = cargoToml.match(/^version = "([^"]+)"$/m)?.[1];

    expect(versionTxt).toBe(pkg.version);
    expect(cargoVersion).toBe(pkg.version);
    expect(nativeManifest.manifestVersion).toBe(
      GENERATED_COMMAND_MANIFEST.manifestVersion,
    );
    expect(nativeManifest.runtimeVersion).toBe(
      GENERATED_COMMAND_MANIFEST.runtimeVersion,
    );
    expect(nativeManifest.cliVersion).toBe(pkg.version);
    expect(nativeManifest.jsonSchemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(nativeManifest.commandPaths).toEqual([...GENERATED_COMMAND_PATHS]);
    expect(nativeManifest.aliasMap).toEqual(GENERATED_COMMAND_ALIAS_MAP);
    expect(nativeManifest.routes.commandRoutes).toEqual(GENERATED_COMMAND_ROUTES);
    expect(Object.keys(nativeManifest.helpTextByPath).sort()).toEqual(
      [...GENERATED_COMMAND_PATHS].sort(),
    );
    expect(nativeManifest.structuredRootHelp).toContain("Usage: privacy-pools");
    const liveGuide = runCli(["guide"], {
      home: createTempHome(),
      env: {
        LANG: "en_US.UTF-8",
        TERM: "xterm-256color",
        COLUMNS: "120",
        NO_COLOR: undefined,
      },
      timeoutMs: 20_000,
    });
    expect(liveGuide.status).toBe(0);
    expect(liveGuide.stdout).toBe("");
    expect(stripAnsi(nativeManifest.guideHumanText).trim()).toBe(
      stripAnsi(liveGuide.stderr).trim(),
    );
    expect(nativeManifest.runtimeConfig.chainNames).toEqual(CHAIN_NAMES);
    expect(nativeManifest.runtimeConfig.mainnetChainNames).toEqual(
      MAINNET_CHAIN_NAMES,
    );
  });

  test("generated native manifest keeps accounts compact-mode nextActions executable", () => {
    const nativeManifest = JSON.parse(
      readFileSync(nativeManifestPath, "utf8"),
    ) as {
      capabilitiesPayload: {
        commandDetails: Record<string, { jsonVariants?: string[] }>;
      };
    };

    const nativeAccountsJsonVariants =
      nativeManifest.capabilitiesPayload.commandDetails.accounts?.jsonVariants ?? [];
    const jsAccountsJsonVariants =
      GENERATED_COMMAND_MANIFEST.capabilitiesPayload.commandDetails.accounts?.jsonVariants ?? [];
    const summaryVariant = nativeAccountsJsonVariants.find((variant) =>
      variant.startsWith("--summary:")
    );
    const pendingOnlyVariant = nativeAccountsJsonVariants.find((variant) =>
      variant.startsWith("--pending-only:")
    );

    expect(nativeAccountsJsonVariants).toEqual(jsAccountsJsonVariants);
    expect(summaryVariant).toContain("nextActions");
    expect(summaryVariant).toContain("cliCommand");
    expect(pendingOnlyVariant).toContain("nextActions");
    expect(pendingOnlyVariant).toContain("cliCommand");
  });

  test(
    "native manifest per-command help matches the live commander help",
    async () => {
    const nativeManifest = JSON.parse(
      readFileSync(nativeManifestPath, "utf8"),
    ) as {
      helpTextByPath: Record<string, string>;
    };
    expect(Object.keys(nativeManifest.helpTextByPath).sort()).toEqual(
      [...GENERATED_COMMAND_PATHS].sort(),
    );

    for (const path of GENERATED_COMMAND_PATHS) {
      const result = runCli([...path.split(" "), "--help"], {
        home: createTempHome(),
        timeoutMs: 20_000,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(stripAnsi(nativeManifest.helpTextByPath[path]).trim()).toBe(
        result.stdout.trim(),
      );
    }
  },
    { timeout: 120_000 },
  );
});
