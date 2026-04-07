import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupDistSnapshot,
  ensureCheckoutDist,
  ensureNativeBinary,
  prepareDistSnapshot,
} from "../../scripts/bench/artifacts.mjs";
import {
  cleanupTrackedTempDir,
  createTrackedTempDir,
} from "../helpers/temp.ts";

function createTempCheckout(prefix) {
  return createTrackedTempDir(prefix);
}

describe("bench artifact helpers", () => {
  test("ensureCheckoutDist returns the existing dist entrypoint without rebuilding", () => {
    const checkout = createTempCheckout("pp-bench-dist-");
    try {
      const distDir = join(checkout, "dist");
      const distPath = join(distDir, "index.js");
      mkdirSync(distDir, { recursive: true });
      writeFileSync(distPath, "console.log('ok');", "utf8");

      let buildCalls = 0;
      expect(ensureCheckoutDist(checkout, () => {
        buildCalls += 1;
      })).toBe(distPath);
      expect(buildCalls).toBe(0);
    } finally {
      cleanupTrackedTempDir(checkout);
    }
  });

  test("ensureCheckoutDist rebuilds when the current dist entrypoint is missing", () => {
    const checkout = createTempCheckout("pp-bench-dist-missing-");
    try {
      const distDir = join(checkout, "dist");
      const distPath = join(distDir, "index.js");

      let buildCalls = 0;
      expect(ensureCheckoutDist(checkout, (cwd) => {
        buildCalls += 1;
        mkdirSync(join(cwd, "dist"), { recursive: true });
        writeFileSync(join(cwd, "dist", "index.js"), "console.log('rebuilt');", "utf8");
      })).toBe(distPath);
      expect(buildCalls).toBe(1);
    } finally {
      cleanupTrackedTempDir(checkout);
    }
  });

  test("ensureNativeBinary rebuilds when the benchmark shell binary is missing", () => {
    const checkout = createTempCheckout("pp-bench-native-");
    try {
      const binaryPath = join(
        checkout,
        "native",
        "shell",
        "target",
        "release",
        process.platform === "win32"
          ? "privacy-pools-cli-native-shell.exe"
          : "privacy-pools-cli-native-shell",
      );

      let buildCalls = 0;
      expect(ensureNativeBinary(checkout, (cwd) => {
        buildCalls += 1;
        mkdirSync(join(cwd, "native", "shell", "target", "release"), { recursive: true });
        writeFileSync(binaryPath, "", "utf8");
      })).toBe(binaryPath);
      expect(buildCalls).toBe(1);
    } finally {
      cleanupTrackedTempDir(checkout);
    }
  });

  test("prepareDistSnapshot copies dist into an isolated temp root", () => {
    const checkout = createTempCheckout("pp-bench-snapshot-");
    try {
      const sourcePath = join(checkout, "dist", "index.js");
      const nodeModulesPath = join(checkout, "node_modules");
      mkdirSync(join(checkout, "dist"), { recursive: true });
      mkdirSync(nodeModulesPath, { recursive: true });
      writeFileSync(sourcePath, "console.log('snapshot');", "utf8");
      writeFileSync(join(checkout, "package.json"), '{"name":"bench-test"}', "utf8");

      const snapshot = prepareDistSnapshot(checkout);
      try {
        expect(snapshot.entrypoint).not.toBe(sourcePath);
        expect(Bun.file(snapshot.entrypoint).text()).resolves.toBe("console.log('snapshot');");
        expect(Bun.file(join(snapshot.root, "package.json")).text()).resolves.toBe('{"name":"bench-test"}');
        expect(join(snapshot.root, "node_modules")).not.toBe(nodeModulesPath);
        expect(existsSync(join(snapshot.root, "node_modules"))).toBe(true);

        writeFileSync(snapshot.entrypoint, "console.log('mutated');", "utf8");
        expect(Bun.file(sourcePath).text()).resolves.toBe("console.log('snapshot');");
      } finally {
        cleanupDistSnapshot(snapshot);
      }
    } finally {
      cleanupTrackedTempDir(checkout);
    }
  });
});
