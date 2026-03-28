import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import { GENERATED_COMMAND_ROUTES } from "../../src/utils/command-manifest.ts";

const nativeShellSource = readdirSync(
  join(CLI_ROOT, "native", "shell", "src"),
)
  .filter((entry) => entry.endsWith(".rs"))
  .sort()
  .map((entry) =>
    readFileSync(join(CLI_ROOT, "native", "shell", "src", entry), "utf8"),
  )
  .join("\n");
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

const EXPECTED_NON_JS_ROUTES = {
  activity: {
    owner: "hybrid",
    nativeModes: ["default", "csv", "structured", "help"],
  },
  capabilities: {
    owner: "native-shell",
    nativeModes: ["default", "help"],
  },
  completion: {
    owner: "native-shell",
    nativeModes: ["default", "help"],
  },
  describe: {
    owner: "native-shell",
    nativeModes: ["default", "help"],
  },
  guide: {
    owner: "native-shell",
    nativeModes: ["default", "help"],
  },
  pools: {
    owner: "hybrid",
    nativeModes: ["default-list", "csv-list", "structured-list", "help"],
  },
  stats: {
    owner: "hybrid",
    nativeModes: ["default", "csv", "structured-default", "structured-global", "help"],
  },
  "stats global": {
    owner: "hybrid",
    nativeModes: ["default", "csv", "structured", "help"],
  },
  "stats pool": {
    owner: "hybrid",
    nativeModes: ["default", "csv", "structured", "help"],
  },
} as const;

const EXPECTED_JS_OWNED_ROUTES = [
  "accounts",
  "deposit",
  "flow",
  "flow ragequit",
  "flow start",
  "flow status",
  "flow watch",
  "history",
  "init",
  "migrate",
  "migrate status",
  "ragequit",
  "status",
  "sync",
  "withdraw",
  "withdraw quote",
] as const;

describe("native safety boundary conformance", () => {
  test("native/public ownership stays limited to the approved route set", () => {
    const generatedNonJsRoutes = Object.fromEntries(
      Object.entries(GENERATED_COMMAND_ROUTES).filter(
        ([, route]) => route.owner !== "js-runtime",
      ),
    );
    const nativeNonJsRoutes = Object.fromEntries(
      Object.entries(nativeManifest.routes.commandRoutes).filter(
        ([, route]) => route.owner !== "js-runtime",
      ),
    );

    expect(generatedNonJsRoutes).toEqual(EXPECTED_NON_JS_ROUTES);
    expect(nativeNonJsRoutes).toEqual(EXPECTED_NON_JS_ROUTES);
  });

  test("sensitive command routes stay JS-owned in generated launcher and native manifests", () => {
    for (const commandPath of EXPECTED_JS_OWNED_ROUTES) {
      expect(GENERATED_COMMAND_ROUTES[commandPath]).toEqual({
        owner: "js-runtime",
        nativeModes: ["help"],
      });

      expect(nativeManifest.routes.commandRoutes[commandPath]).toEqual({
        owner: "js-runtime",
        nativeModes: ["help"],
      });
    }
  });

  test("pools stays nativeized only for public list mode, not detail mode", () => {
    expect(GENERATED_COMMAND_ROUTES.pools).toEqual({
      owner: "hybrid",
      nativeModes: ["default-list", "csv-list", "structured-list", "help"],
    });

    expect(nativeManifest.routes.commandRoutes.pools).toEqual({
      owner: "hybrid",
      nativeModes: ["default-list", "csv-list", "structured-list", "help"],
    });
  });

  test("stats pool keeps native ownership limited to public render-only modes", () => {
    expect(GENERATED_COMMAND_ROUTES["stats pool"]).toEqual({
      owner: "hybrid",
      nativeModes: ["default", "csv", "structured", "help"],
    });

    expect(nativeManifest.routes.commandRoutes["stats pool"]).toEqual({
      owner: "hybrid",
      nativeModes: ["default", "csv", "structured", "help"],
    });
  });

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
      "quoteExpiresAt",
      "feeCommitment",
      "proofPublicSignals",
      "solidityProof",
      "precommitment",
      "mnemonicToAccount",
      "use secp256k1",
    ];

    for (const marker of forbiddenMarkers) {
      expect(nativeShellSource).not.toContain(marker);
    }
  });
});
