import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  BURN_RECIPIENT_ADDRESSES,
  LOW_BURN_ADDRESS,
  ZERO_ADDRESS,
} from "../../src/utils/known-addresses.js";
import { assertSafeRecipientAddress } from "../../src/utils/recipient-safety.js";
import { CLI_ROOT } from "../helpers/paths.ts";

const JS_ADDRESS_BOOK = join(CLI_ROOT, "src", "utils", "known-addresses.ts");
const NATIVE_ADDRESS_BOOK = join(CLI_ROOT, "native", "shell", "src", "known_addresses.rs");

function walkFiles(root: string, extensions: readonly string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walkFiles(path, extensions));
    } else if (extensions.some((extension) => path.endsWith(extension))) {
      files.push(path);
    }
  }
  return files;
}

function stripRustTestModules(source: string): string {
  return source.replace(/#\[cfg\(test\)\]\s*mod tests\s*\{[\s\S]*$/m, "");
}

describe("known address canonicality", () => {
  test("runtime source uses the canonical address-book modules for sentinel addresses", () => {
    const scannedFiles = [
      ...walkFiles(join(CLI_ROOT, "src"), [".ts"]).filter(
        (file) => file !== JS_ADDRESS_BOOK && !file.endsWith("command-manifest.ts"),
      ),
      ...walkFiles(join(CLI_ROOT, "native", "shell", "src"), [".rs"]).filter(
        (file) => file !== NATIVE_ADDRESS_BOOK,
      ),
    ];
    const sentinelAddresses = [ZERO_ADDRESS, ...BURN_RECIPIENT_ADDRESSES].map((address) =>
      address.toLowerCase(),
    );
    const offenders: string[] = [];

    for (const file of scannedFiles) {
      const rawSource = readFileSync(file, "utf8");
      const source = file.endsWith(".rs") ? stripRustTestModules(rawSource) : rawSource;
      const normalizedSource = source.toLowerCase();
      for (const address of sentinelAddresses) {
        if (normalizedSource.includes(address)) {
          offenders.push(`${relative(CLI_ROOT, file)} inlines ${address}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("recipient safety rejects burn addresses before checksum normalization", () => {
    const mixedCaseBurnAddress = LOW_BURN_ADDRESS.replace("dead", "dEaD");

    expect(() =>
      assertSafeRecipientAddress(mixedCaseBurnAddress as `0x${string}`),
    ).toThrow("appears to be a burn address");
  });
});
