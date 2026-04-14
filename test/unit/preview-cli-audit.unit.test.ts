import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  cleanupPreviewAuditArtifacts,
  KEEP_PREVIEW_AUDIT_ARTIFACTS_ENV,
  shouldRetainPreviewAuditArtifacts,
} from "../../scripts/preview-cli-audit.mjs";

describe("preview cli audit artifact retention", () => {
  test("cleans up successful audit artifacts by default", () => {
    expect(shouldRetainPreviewAuditArtifacts({ failed: false, env: {} })).toBe(
      false,
    );
  });

  test("retains artifacts when the audit reports failures", () => {
    expect(shouldRetainPreviewAuditArtifacts({ failed: true, env: {} })).toBe(
      true,
    );
  });

  test("retains artifacts when the opt-in env override is set", () => {
    expect(
      shouldRetainPreviewAuditArtifacts({
        failed: false,
        env: { [KEEP_PREVIEW_AUDIT_ARTIFACTS_ENV]: "1" },
      }),
    ).toBe(true);
  });

  test("cleanupPreviewAuditArtifacts removes the artifact root recursively", () => {
    const artifactDir = createTrackedTempDir("pp-preview-audit-test-");
    writeFileSync(join(artifactDir, "preview-coverage-report.json"), "{}\n");

    expect(existsSync(artifactDir)).toBe(true);
    cleanupPreviewAuditArtifacts(artifactDir);
    expect(existsSync(artifactDir)).toBe(false);
  });
});
