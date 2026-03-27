import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import { GENERATED_COMMAND_ROUTES } from "../../src/utils/command-manifest.ts";

const nativeShellSource = readFileSync(
  join(CLI_ROOT, "native", "shell", "src", "main.rs"),
  "utf8",
);
const nativeManifest = JSON.parse(
  readFileSync(
    join(CLI_ROOT, "native", "shell", "generated", "manifest.json"),
    "utf8",
  ),
) as {
  routes: {
    commandRoutes: Record<string, { owner: string; nativeModes: string[] }>;
  };
};

describe("native safety boundary conformance", () => {
  test("status stays JS-owned in generated launcher and native manifests", () => {
    expect(GENERATED_COMMAND_ROUTES.status).toEqual({
      owner: "js-runtime",
      nativeModes: ["help"],
    });

    expect(nativeManifest.routes.commandRoutes.status).toEqual({
      owner: "js-runtime",
      nativeModes: ["help"],
    });
  });

  test("native shell source does not touch signer, mnemonic, or account-state helpers", () => {
    const forbiddenMarkers = [
      ".mnemonic",
      ".signer",
      "PRIVACY_POOLS_PRIVATE_KEY",
      "handle_status_native",
      "should_handle_status_native",
      "load_signer_key",
      "derive_signer_address",
      "account_has_deposits",
      "mnemonic_file_path",
      "signer_file_path",
      "accounts_dir(",
      "workflow",
      "workflows",
      "transactions",
      "relayerRequest",
      "precommitment",
      "use secp256k1",
    ];

    for (const marker of forbiddenMarkers) {
      expect(nativeShellSource).not.toContain(marker);
    }
  });
});
