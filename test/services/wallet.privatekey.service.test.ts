import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPrivateKey, getSignerAddress } from "../../src/services/wallet.ts";
import { CLIError } from "../../src/utils/errors.ts";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";

const VALID_KEY_NO_PREFIX =
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VALID_KEY_WITH_PREFIX = `0x${VALID_KEY_NO_PREFIX}`;

describe("loadPrivateKey", () => {
  const origHome = process.env.PRIVACY_POOLS_HOME;
  const origKey = process.env.PRIVACY_POOLS_PRIVATE_KEY;

  afterEach(() => {
    // Restore env
    if (origHome !== undefined) {
      process.env.PRIVACY_POOLS_HOME = origHome;
    } else {
      delete process.env.PRIVACY_POOLS_HOME;
    }
    if (origKey !== undefined) {
      process.env.PRIVACY_POOLS_PRIVATE_KEY = origKey;
    } else {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    }
    cleanupTrackedTempDirs();
  });

  function isolatedHome(): string {
    return createTrackedTempDir("pp-wallet-pk-test-");
  }

  function writeSignerFile(homeDir: string, content: string): void {
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(join(homeDir, ".signer"), content, { encoding: "utf-8" });
  }

  test("env var PRIVACY_POOLS_PRIVATE_KEY takes precedence over .signer file", () => {
    const home = isolatedHome();
    writeSignerFile(home, "0x1111111111111111111111111111111111111111111111111111111111111111");
    process.env.PRIVACY_POOLS_HOME = home;
    process.env.PRIVACY_POOLS_PRIVATE_KEY = VALID_KEY_WITH_PREFIX;

    const result = loadPrivateKey();
    expect(result).toBe(VALID_KEY_WITH_PREFIX);
    // Verify it is NOT the file key
    const fileAddr = getSignerAddress(
      "0x1111111111111111111111111111111111111111111111111111111111111111"
    );
    const envAddr = getSignerAddress(result);
    expect(envAddr).not.toBe(fileAddr);
  });

  test("normalizes non-0x-prefixed key from env var", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    process.env.PRIVACY_POOLS_PRIVATE_KEY = VALID_KEY_NO_PREFIX;

    const result = loadPrivateKey();
    expect(result).toBe(VALID_KEY_WITH_PREFIX);
    expect(result.startsWith("0x")).toBe(true);
  });

  test("normalizes non-0x-prefixed key from .signer file", () => {
    const home = isolatedHome();
    writeSignerFile(home, VALID_KEY_NO_PREFIX);
    process.env.PRIVACY_POOLS_HOME = home;
    delete process.env.PRIVACY_POOLS_PRIVATE_KEY;

    const result = loadPrivateKey();
    expect(result).toBe(VALID_KEY_WITH_PREFIX);
  });

  test("rejects key with wrong length (too short)", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    process.env.PRIVACY_POOLS_PRIVATE_KEY = "0xabcdef1234";

    try {
      loadPrivateKey();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const e = err as CLIError;
      expect(e.category).toBe("SETUP");
      expect(e.message).toContain("Invalid private key format");
      expect(e.hint).toContain("64-character hex");
    }
  });

  test("rejects key with non-hex characters", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    // 64 chars but with 'zz' which is not valid hex
    process.env.PRIVACY_POOLS_PRIVATE_KEY =
      "0xzz0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    try {
      loadPrivateKey();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).category).toBe("SETUP");
    }
  });

  test("rejects key with too many characters", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    process.env.PRIVACY_POOLS_PRIVATE_KEY = "0x" + "aa".repeat(33); // 66 hex chars, too long

    try {
      loadPrivateKey();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).category).toBe("SETUP");
    }
  });

  test("valid key round-trips to deterministic signer address", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    process.env.PRIVACY_POOLS_PRIVATE_KEY = VALID_KEY_WITH_PREFIX;

    const key = loadPrivateKey();
    const addr1 = getSignerAddress(key);
    const addr2 = getSignerAddress(key);

    expect(addr1).toBe(addr2);
    expect(addr1).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("reads key from .signer file when env var is not set", () => {
    const home = isolatedHome();
    writeSignerFile(home, VALID_KEY_WITH_PREFIX);
    process.env.PRIVACY_POOLS_HOME = home;
    delete process.env.PRIVACY_POOLS_PRIVATE_KEY;

    const result = loadPrivateKey();
    expect(result).toBe(VALID_KEY_WITH_PREFIX);
  });
});
