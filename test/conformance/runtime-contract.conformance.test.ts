import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_PROTOCOL_PROFILE,
  buildRuntimeCompatibilityDescriptor,
  PROTOCOL_ACCOUNT_FILE_VERSION,
  PROTOCOL_JSON_SCHEMA_VERSION,
  PROTOCOL_WORKFLOW_SECRET_RECORD_VERSION,
  PROTOCOL_WORKFLOW_SNAPSHOT_VERSION,
} from "../../src/config/protocol-profile.js";
import { readCliPackageInfo } from "../../src/package-info.ts";
import { CURRENT_RUNTIME_DESCRIPTOR } from "../../src/runtime/runtime-contract.js";
import { ACCOUNT_FILE_VERSION } from "../../src/services/account-storage.ts";
import {
  WORKFLOW_SECRET_RECORD_VERSION,
  WORKFLOW_SNAPSHOT_VERSION,
} from "../../src/services/workflow-storage-version.ts";
import { GENERATED_COMMAND_MANIFEST } from "../../src/utils/command-manifest.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

const nativeManifestPath = join(
  CLI_ROOT,
  "native",
  "shell",
  "generated",
  "manifest.json",
);
const nativeRuntimeContractPath = join(
  CLI_ROOT,
  "native",
  "shell",
  "generated",
  "runtime-contract.json",
);
const prepareNativePackageScript = readFileSync(
  join(CLI_ROOT, "scripts", "prepare-native-package.mjs"),
  "utf8",
);
const verifyNativePackageScript = readFileSync(
  join(CLI_ROOT, "scripts", "verify-packed-native-package.mjs"),
  "utf8",
);
const launcherSource = readFileSync(
  join(CLI_ROOT, "src", "launcher.ts"),
  "utf8",
);
const nativeShellSource = readFileSync(
  join(CLI_ROOT, "native", "shell", "src", "main.rs"),
  "utf8",
);

describe("runtime contract conformance", () => {
  test("generated discovery artifacts expose the active protocol and runtime metadata", () => {
    const nativeManifest = JSON.parse(
      readFileSync(nativeManifestPath, "utf8"),
    ) as {
      manifestVersion: string;
      runtimeVersion: string;
      capabilitiesPayload: {
        protocol: unknown;
        runtime: unknown;
      };
    };
    const cliVersion = readCliPackageInfo(import.meta.url).version;
    const expectedRuntime = buildRuntimeCompatibilityDescriptor(cliVersion);
    const generatedRuntimeContract = JSON.parse(
      readFileSync(nativeRuntimeContractPath, "utf8"),
    ) as typeof CURRENT_RUNTIME_DESCRIPTOR;

    expect(GENERATED_COMMAND_MANIFEST.manifestVersion).toBe(
      CURRENT_RUNTIME_DESCRIPTOR.manifestVersion,
    );
    expect(GENERATED_COMMAND_MANIFEST.runtimeVersion).toBe(
      CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
    );
    expect(GENERATED_COMMAND_MANIFEST.capabilitiesPayload.protocol).toEqual(
      CLI_PROTOCOL_PROFILE,
    );
    expect(GENERATED_COMMAND_MANIFEST.capabilitiesPayload.runtime).toEqual(
      expectedRuntime,
    );

    expect(nativeManifest.manifestVersion).toBe(
      CURRENT_RUNTIME_DESCRIPTOR.manifestVersion,
    );
    expect(nativeManifest.runtimeVersion).toBe(
      CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
    );
    expect(nativeManifest.capabilitiesPayload.protocol).toEqual(
      CLI_PROTOCOL_PROFILE,
    );
    expect(nativeManifest.capabilitiesPayload.runtime).toEqual(expectedRuntime);
    expect(generatedRuntimeContract).toEqual(CURRENT_RUNTIME_DESCRIPTOR);
  });

  test("protocol profile storage/schema constants stay aligned with the TS runtime", () => {
    expect(PROTOCOL_JSON_SCHEMA_VERSION).toBe(JSON_SCHEMA_VERSION);
    expect(PROTOCOL_ACCOUNT_FILE_VERSION).toBe(ACCOUNT_FILE_VERSION);
    expect(PROTOCOL_WORKFLOW_SNAPSHOT_VERSION).toBe(
      WORKFLOW_SNAPSHOT_VERSION,
    );
    expect(PROTOCOL_WORKFLOW_SECRET_RECORD_VERSION).toBe(
      WORKFLOW_SECRET_RECORD_VERSION,
    );
  });

  test("launcher and native packaging scripts gate on the current protocol/runtime metadata", () => {
    expect(prepareNativePackageScript).toContain("binaryPath");
    expect(prepareNativePackageScript).toContain("protocolProfile");
    expect(prepareNativePackageScript).toContain("CLI_PROTOCOL_PROFILE.profile");
    expect(prepareNativePackageScript).toContain("CURRENT_RUNTIME_DESCRIPTOR");
    expect(prepareNativePackageScript).not.toContain('"privacy-pools": `bin/');

    expect(verifyNativePackageScript).toContain("binaryPath");
    expect(verifyNativePackageScript).toContain(
      "must not publish the public privacy-pools bin entry",
    );
    expect(verifyNativePackageScript).toContain("protocol profile mismatch");
    expect(verifyNativePackageScript).toContain("CURRENT_RUNTIME_DESCRIPTOR");

    expect(launcherSource).toContain("binaryPath");
    expect(launcherSource).toContain("protocolProfile");
    expect(launcherSource).toContain("CLI_PROTOCOL_PROFILE.profile");
    expect(launcherSource).toContain("CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion");
    expect(nativeShellSource).toContain("runtime-contract.json");
  });
});
