import { describe, expect, test } from "bun:test";
import {
  buildCapabilitiesPayload,
  buildCommandDescriptor,
  COMMAND_PATHS,
  GLOBAL_FLAG_METADATA,
  listCommandPaths,
  resolveCommandPath,
} from "../../src/utils/command-discovery-metadata.ts";
import {
  listStaticCommandPaths,
  resolveStaticCommandPath,
  STATIC_CAPABILITIES_PAYLOAD,
  STATIC_COMMAND_PATHS,
  STATIC_GLOBAL_FLAG_METADATA,
} from "../../src/utils/command-discovery-static.ts";
import {
  GENERATED_COMMAND_MANIFEST,
  GENERATED_ROOT_COMMANDS,
} from "../../src/utils/command-manifest.ts";
import {
  GENERATED_COMMAND_ALIAS_MAP,
  GENERATED_COMMAND_PATHS,
  GENERATED_COMMAND_ROUTES,
  GENERATED_STATIC_LOCAL_COMMANDS,
  GENERATED_TOKENIZED_COMMAND_ROUTES,
} from "../../src/utils/command-routing-static.ts";

describe("command discovery static conformance", () => {
  const sentinelCommands = [
    "guide",
    "pools",
    "pools stats",
    "withdraw",
    "flow watch",
  ] as const;

  test("static command path catalog and alias resolution stay aligned", () => {
    expect([...STATIC_COMMAND_PATHS]).toEqual(listCommandPaths());
    expect(listStaticCommandPaths()).toEqual(listCommandPaths());

    for (const path of sentinelCommands) {
      expect(resolveStaticCommandPath(path)).toBe(path);
      expect(resolveStaticCommandPath(path.split(" "))).toBe(path);
    }

    expect(resolveStaticCommandPath("exit")).toBeNull();
    expect(resolveCommandPath("exit")).toBeNull();
    expect(resolveStaticCommandPath("not-a-command")).toBeNull();
  });

  test("static and generated capabilities keep every descriptor aligned", () => {
    const runtimeCapabilities = buildCapabilitiesPayload();

    for (const path of STATIC_COMMAND_PATHS) {
      const descriptor = buildCommandDescriptor(path);
      expect(STATIC_CAPABILITIES_PAYLOAD.commandDetails[path]).toEqual(descriptor);
      expect(runtimeCapabilities.commandDetails[path]).toEqual(descriptor);
      expect(GENERATED_COMMAND_MANIFEST.capabilitiesPayload.commandDetails[path]).toEqual(
        descriptor,
      );
    }

    expect(STATIC_GLOBAL_FLAG_METADATA).toEqual(GLOBAL_FLAG_METADATA);
    expect(GENERATED_COMMAND_MANIFEST.capabilitiesPayload.exitCodes).toEqual(
      STATIC_CAPABILITIES_PAYLOAD.exitCodes,
    );
    expect(GENERATED_COMMAND_MANIFEST.capabilitiesPayload.envVars).toEqual(
      STATIC_CAPABILITIES_PAYLOAD.envVars,
    );
  });

  test("generated routing metadata preserves key ownership contracts", () => {
    expect(GENERATED_STATIC_LOCAL_COMMANDS).toEqual([
      "guide",
      "capabilities",
      "describe",
      "completion",
    ]);
    expect(GENERATED_COMMAND_ALIAS_MAP).toEqual({});
    expect(GENERATED_COMMAND_PATHS).toContain("guide");
    expect(GENERATED_COMMAND_PATHS).toContain("pools");
    expect(GENERATED_COMMAND_PATHS).toContain("withdraw");

    expect(GENERATED_COMMAND_ROUTES.guide).toEqual({
      owner: "native-shell",
      nativeModes: ["default", "help"],
    });
    expect(GENERATED_COMMAND_ROUTES.pools).toEqual({
      owner: "hybrid",
      nativeModes: ["default-list", "csv-list", "structured-list", "help"],
    });
    expect(GENERATED_COMMAND_ROUTES["pools show"]).toEqual({
      owner: "hybrid",
      nativeModes: ["default-detail", "structured-detail", "help"],
    });
    expect(GENERATED_COMMAND_ROUTES["pools activity"]).toEqual({
      owner: "hybrid",
      nativeModes: ["default", "csv", "structured", "help"],
    });
    expect(GENERATED_COMMAND_ROUTES["pools stats"]).toEqual({
      owner: "hybrid",
      nativeModes: ["default", "csv", "structured", "help"],
    });
    expect(GENERATED_COMMAND_ROUTES.withdraw).toEqual({
      owner: "js-runtime",
      nativeModes: ["help"],
    });
    expect(
      GENERATED_TOKENIZED_COMMAND_ROUTES.every((entry) =>
        entry.route.split(" ").join(" ") === entry.tokens.join(" ")
      ),
    ).toBe(true);
    expect(
      GENERATED_TOKENIZED_COMMAND_ROUTES.every((entry, index, all) =>
        index === 0 || all[index - 1]!.tokens.length >= entry.tokens.length
      ),
    ).toBe(true);
  });

  test("generated manifest preserves root-command and accounts descriptor contracts", () => {
    for (const rootCommand of GENERATED_ROOT_COMMANDS) {
      expect(COMMAND_PATHS).toContain(rootCommand.name);
      expect(GENERATED_COMMAND_MANIFEST.capabilitiesPayload.commandDetails[
        rootCommand.name
      ]?.description).toBe(rootCommand.description);
    }
    expect(GENERATED_COMMAND_MANIFEST.commandRoutes.guide).toEqual(
      GENERATED_COMMAND_ROUTES.guide,
    );
    expect(GENERATED_COMMAND_MANIFEST.commandRoutes.pools).toEqual(
      GENERATED_COMMAND_ROUTES.pools,
    );
    expect(GENERATED_COMMAND_MANIFEST.commandRoutes.withdraw).toEqual(
      GENERATED_COMMAND_ROUTES.withdraw,
    );

    const accountsJsonVariants =
      GENERATED_COMMAND_MANIFEST.capabilitiesPayload.commandDetails.accounts
        ?.jsonVariants ?? [];
    const summaryVariant = accountsJsonVariants.find((variant) =>
      variant.startsWith("--summary:"),
    );
    const pendingOnlyVariant = accountsJsonVariants.find((variant) =>
      variant.startsWith("--pending-only:"),
    );

    expect(summaryVariant).toContain("nextActions");
    expect(summaryVariant).toContain("cliCommand");

    expect(pendingOnlyVariant).toContain("nextActions");
    expect(pendingOnlyVariant).toContain("cliCommand");
  });
});
