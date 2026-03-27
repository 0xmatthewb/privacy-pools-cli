/**
 * Versioning for local workflow persistence only.
 *
 * Keep these separate from the public CLI JSON envelope version so a future
 * stdout contract change does not imply an on-disk workflow migration.
 */

export const WORKFLOW_SNAPSHOT_VERSION = "1";
export const WORKFLOW_SECRET_RECORD_VERSION = "1";

/**
 * Backward-compatible versions written before workflow persistence was
 * decoupled from the public JSON envelope.
 */
export const LEGACY_WORKFLOW_SNAPSHOT_VERSIONS = ["1.5.0"] as const;
export const LEGACY_WORKFLOW_SECRET_RECORD_VERSIONS = ["1.5.0"] as const;
