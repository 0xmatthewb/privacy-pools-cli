import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

const require = createRequire(import.meta.url);

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("sdk dependency conformance", () => {
  test("pins @0xbow/privacy-pools-core-sdk to an exact version", () => {
    const pkg = JSON.parse(
      readFileSync(`${CLI_ROOT}/package.json`, "utf8")
    ) as { dependencies?: Record<string, string> };

    const declared = pkg.dependencies?.["@0xbow/privacy-pools-core-sdk"];
    expect(typeof declared).toBe("string");
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("installed SDK version matches declared exact dependency", () => {
    const pkg = JSON.parse(
      readFileSync(`${CLI_ROOT}/package.json`, "utf8")
    ) as { dependencies?: Record<string, string> };
    const sdkPackageJsonPath = require.resolve(
      "@0xbow/privacy-pools-core-sdk/package.json"
    );
    const sdkPkg = JSON.parse(
      readFileSync(
        sdkPackageJsonPath,
        "utf8"
      )
    ) as { version: string };

    const declared = pkg.dependencies?.["@0xbow/privacy-pools-core-sdk"];
    expect(sdkPkg.version).toBe(declared);
  });

  test("lockfiles resolve the exact SDK version from npm", () => {
    const packageLock = readFileSync(`${CLI_ROOT}/package-lock.json`, "utf8");
    const bunLock = readFileSync(`${CLI_ROOT}/bun.lock`, "utf8");

    expect(packageLock).toContain(
      '"@0xbow/privacy-pools-core-sdk": "1.2.0"'
    );
    expect(packageLock).toContain(
      "https://registry.npmjs.org/@0xbow/privacy-pools-core-sdk/-/privacy-pools-core-sdk-1.2.0.tgz"
    );
    expect(bunLock).toContain('@0xbow/privacy-pools-core-sdk": "1.2.0"');
    expect(bunLock).toContain("@0xbow/privacy-pools-core-sdk@1.2.0");
  });

  test("installed SDK bundle derives master keys with bytesToBigInt", () => {
    const sdkPackageJsonPath = require.resolve(
      "@0xbow/privacy-pools-core-sdk/package.json"
    );
    const sdkRoot = dirname(sdkPackageJsonPath);
    const nodeDistDir = join(sdkRoot, "dist", "node");
    const bundleFile = readdirSync(nodeDistDir).find(
      (name) => name.startsWith("index-") && name.endsWith(".js")
    );

    expect(bundleFile).toBeDefined();

    const bundle = readFileSync(join(nodeDistDir, bundleFile!), "utf8");
    const fnStart = bundle.indexOf("function generateMasterKeys(mnemonic)");

    expect(fnStart).toBeGreaterThanOrEqual(0);

    const fnBody = bundle.slice(fnStart, fnStart + 500);
    expect(fnBody).toContain("bytesToBigInt");
    expect(fnBody).not.toContain("bytesToNumber");
  });

  test("cli wallet derivation delegates to the SDK instead of reimplementing it", () => {
    const walletService = readFileSync(
      `${CLI_ROOT}/src/services/wallet.ts`,
      "utf8"
    );

    expect(walletService).toContain(
      'import { generateMasterKeys } from "@0xbow/privacy-pools-core-sdk";'
    );
    expect(walletService).toContain("return withSuppressedSdkStdoutSync(() => generateMasterKeys(mnemonic));");
    expect(walletService).not.toContain("mnemonicToAccount");
    expect(walletService).not.toContain("bytesToNumber");
    expect(walletService).not.toContain("bytesToBigInt");
  });

  test("cli source tree does not reimplement mnemonic master-key derivation or import local SDK copies", () => {
    const srcFiles = collectTsFiles(join(CLI_ROOT, "src"));
    const suspiciousDerivationFiles: string[] = [];
    const localSdkImportFiles: string[] = [];

    for (const file of srcFiles) {
      const source = readFileSync(file, "utf8");
      if (
        source.includes("mnemonicToAccount") ||
        source.includes("bytesToNumber") ||
        source.includes("bytesToBigInt")
      ) {
        suspiciousDerivationFiles.push(file);
      }
      if (
        /from\s+["'](?:\.\.?\/).*privacy-pools-core-sdk/.test(source) ||
        source.includes("node_modules/@0xbow/privacy-pools-core-sdk")
      ) {
        localSdkImportFiles.push(file);
      }
    }

    expect(suspiciousDerivationFiles).toEqual([]);
    expect(localSdkImportFiles).toEqual([]);
  });
});
