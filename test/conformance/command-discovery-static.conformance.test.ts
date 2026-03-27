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
  GENERATED_COMMAND_ROUTES,
  GENERATED_ROOT_COMMANDS,
  GENERATED_STATIC_LOCAL_COMMANDS,
} from "../../src/utils/command-manifest.ts";

describe("command discovery static conformance", () => {
  test("static command path catalog matches runtime discovery metadata", () => {
    expect([...STATIC_COMMAND_PATHS]).toEqual([...COMMAND_PATHS]);
    expect(listStaticCommandPaths()).toEqual(listCommandPaths());
  });

  test("static capabilities payload matches runtime-derived capabilities payload", () => {
    expect(STATIC_CAPABILITIES_PAYLOAD).toEqual(buildCapabilitiesPayload());
    expect(GENERATED_COMMAND_MANIFEST.capabilitiesPayload).toEqual(
      buildCapabilitiesPayload(),
    );
  });

  test("static global flag metadata stays aligned", () => {
    expect(STATIC_GLOBAL_FLAG_METADATA).toEqual(GLOBAL_FLAG_METADATA);
  });

  test("static command resolution matches runtime command resolution", () => {
    for (const path of COMMAND_PATHS) {
      expect(resolveStaticCommandPath(path)).toBe(path);
      expect(resolveStaticCommandPath(path.split(" "))).toBe(path);
      expect(STATIC_CAPABILITIES_PAYLOAD.commandDetails[path]).toEqual(
        buildCommandDescriptor(path),
      );
    }

    expect(resolveStaticCommandPath("exit")).toBe(resolveCommandPath("exit"));
    expect(resolveStaticCommandPath("not-a-command")).toBeNull();
  });

  test("generated manifest stays aligned on root commands, static-local commands, and ownership", () => {
    expect(GENERATED_COMMAND_MANIFEST.commandPaths).toEqual(COMMAND_PATHS);
    expect(GENERATED_STATIC_LOCAL_COMMANDS).toEqual([
      "guide",
      "capabilities",
      "describe",
      "completion",
    ]);

    for (const rootCommand of GENERATED_ROOT_COMMANDS) {
      expect(COMMAND_PATHS).toContain(rootCommand.name);
      expect(GENERATED_COMMAND_MANIFEST.capabilitiesPayload.commandDetails[
        rootCommand.name
      ]?.description).toBe(rootCommand.description);
    }

    for (const path of COMMAND_PATHS) {
      expect(GENERATED_COMMAND_MANIFEST.commandRoutes[path]).toEqual(
        GENERATED_COMMAND_ROUTES[path],
      );
    }
  });
});
