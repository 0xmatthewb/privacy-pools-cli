import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { probeConfigHomeWritability } from "../../src/runtime/config-paths.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const canAssertChmodReadOnly =
  process.platform !== "win32" && process.getuid?.() !== 0;

function restoreWritable(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // Best effort so temp-dir cleanup can proceed.
  }
}

afterEach(() => {
  cleanupTrackedTempDirs();
});

describe("probeConfigHomeWritability", () => {
  test("returns null when the configured home can be created", () => {
    const home = createTrackedTempDir("pp-config-probe-home-");
    const configHome = join(home, ".privacy-pools");

    expect(
      probeConfigHomeWritability({
        PRIVACY_POOLS_HOME: configHome,
      }),
    ).toBeNull();
  });

  test.skipIf(!canAssertChmodReadOnly)(
    "reports exists_readonly when the config home exists without write permission",
    () => {
      const home = createTrackedTempDir("pp-config-probe-existing-");
      const configHome = join(home, ".privacy-pools");
      mkdirSync(configHome, { recursive: true, mode: 0o700 });

      try {
        chmodSync(configHome, 0o500);
        const issue = probeConfigHomeWritability({
          PRIVACY_POOLS_HOME: configHome,
        });

        expect(issue?.code).toBe("home_not_writable");
        expect(issue?.reasonCode).toBe("exists_readonly");
        expect(issue?.message).toContain(configHome);
      } finally {
        restoreWritable(configHome);
      }
    },
  );

  test.skipIf(!canAssertChmodReadOnly)(
    "reports parent_readonly when the nearest existing parent is not writable",
    () => {
      const parent = createTrackedTempDir("pp-config-probe-parent-");
      const configHome = join(parent, ".privacy-pools");

      try {
        chmodSync(parent, 0o500);
        const issue = probeConfigHomeWritability({
          PRIVACY_POOLS_HOME: configHome,
        });

        expect(issue?.code).toBe("home_not_writable");
        expect(issue?.reasonCode).toBe("parent_readonly");
        expect(issue?.message).toContain(configHome);
      } finally {
        restoreWritable(parent);
      }
    },
  );

  test("reports parent_missing when no non-root ancestor exists", () => {
    const missingRoot = `/pp-config-probe-missing-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const configHome = join(missingRoot, ".privacy-pools");

    const issue = probeConfigHomeWritability({
      PRIVACY_POOLS_HOME: configHome,
    });

    expect(issue?.code).toBe("home_not_writable");
    expect(issue?.reasonCode).toBe("parent_missing");
    expect(issue?.message).toContain(configHome);
  });

  test.skipIf(!canAssertChmodReadOnly)(
    "probes the operator-stated home even when a writable legacy home exists",
    () => {
      const osHome = createTrackedTempDir("pp-config-probe-legacy-");
      const readonlyParent = createTrackedTempDir("pp-config-probe-intended-");
      const legacyHome = join(osHome, ".privacy-pools");
      const intendedHome = join(readonlyParent, "privacy-pools");
      mkdirSync(legacyHome, { recursive: true, mode: 0o700 });

      try {
        chmodSync(readonlyParent, 0o500);
        const issue = probeConfigHomeWritability({
          HOME: osHome,
          PRIVACY_POOLS_HOME: intendedHome,
        });

        expect(issue?.code).toBe("home_not_writable");
        expect(issue?.reasonCode).toBe("parent_readonly");
        expect(issue?.message).toContain(intendedHome);
      } finally {
        restoreWritable(readonlyParent);
      }
    },
  );
});
