import { describe, expect, test } from "bun:test";
import {
  integrityForBuffer,
  normalizeViewedPackageMetadata,
} from "../../scripts/verify-npm-published-artifact.mjs";

describe("verify npm published artifact helpers", () => {
  test("integrityForBuffer returns npm-style sha512 integrity strings", () => {
    expect(integrityForBuffer(Buffer.from("privacy-pools"))).toBe(
      "sha512-xi0KEKYzjjM8YozFyoJPVyZoVmevCL+mdxu4YKGoLW0WWvHB+zV7OjbPg6FA8XNP76lvA3eRRqmPkZm6oUE2Hg==",
    );
  });

  test("normalizeViewedPackageMetadata reads nested dist metadata", () => {
    expect(
      normalizeViewedPackageMetadata({
        name: "privacy-pools-cli",
        version: "2.0.0",
        dist: {
          integrity: "sha512-local",
          tarball: "https://registry.npmjs.org/privacy-pools-cli/-/privacy-pools-cli-2.0.0.tgz",
        },
      }),
    ).toEqual({
      name: "privacy-pools-cli",
      version: "2.0.0",
      integrity: "sha512-local",
      tarball:
        "https://registry.npmjs.org/privacy-pools-cli/-/privacy-pools-cli-2.0.0.tgz",
    });
  });

  test("normalizeViewedPackageMetadata accepts flat npm view property output", () => {
    expect(
      normalizeViewedPackageMetadata({
        name: "privacy-pools-cli",
        version: "2.0.0",
        "dist.integrity": "sha512-flat",
        "dist.tarball":
          "https://registry.npmjs.org/privacy-pools-cli/-/privacy-pools-cli-2.0.0.tgz",
      }),
    ).toEqual({
      name: "privacy-pools-cli",
      version: "2.0.0",
      integrity: "sha512-flat",
      tarball:
        "https://registry.npmjs.org/privacy-pools-cli/-/privacy-pools-cli-2.0.0.tgz",
    });
  });
});
