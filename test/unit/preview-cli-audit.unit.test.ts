import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  annotatePreviewAuditError,
  cleanupPreviewAuditArtifacts,
  getPreviewAuditArtifactDir,
  KEEP_PREVIEW_AUDIT_ARTIFACTS_ENV,
  shouldRetainPreviewAuditArtifacts,
  shouldRetainPreviewAuditArtifactsOnCrash,
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

  test("cleans up unexpected crash artifacts unless retention is explicitly requested", () => {
    expect(shouldRetainPreviewAuditArtifactsOnCrash({ env: {} })).toBe(false);
    expect(
      shouldRetainPreviewAuditArtifactsOnCrash({
        env: { [KEEP_PREVIEW_AUDIT_ARTIFACTS_ENV]: "1" },
      }),
    ).toBe(true);
  });

  test("annotatePreviewAuditError preserves the retained artifact directory", () => {
    const artifactDir = createTrackedTempDir("pp-preview-audit-crash-");
    const error = annotatePreviewAuditError(new Error("boom"), artifactDir);

    expect(error.message).toBe("boom");
    expect(getPreviewAuditArtifactDir(error)).toBe(artifactDir);
    expect(getPreviewAuditArtifactDir(new Error("plain"))).toBeNull();
  });

  test("annotatePreviewAuditError wraps non-Error throwables", () => {
    const artifactDir = createTrackedTempDir("pp-preview-audit-string-");
    const error = annotatePreviewAuditError("boom", artifactDir);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
    expect(getPreviewAuditArtifactDir(error)).toBe(artifactDir);
  });

  test("cleanupPreviewAuditArtifacts removes the artifact root recursively", () => {
    const artifactDir = createTrackedTempDir("pp-preview-audit-test-");
    writeFileSync(join(artifactDir, "preview-coverage-report.json"), "{}\n");

    expect(existsSync(artifactDir)).toBe(true);
    cleanupPreviewAuditArtifacts(artifactDir);
    expect(existsSync(artifactDir)).toBe(false);
  });
});
