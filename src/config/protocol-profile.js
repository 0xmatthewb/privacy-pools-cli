import { CURRENT_RUNTIME_DESCRIPTOR } from "../runtime/runtime-contract.js";

// Keep this module JS-only so both Node scripts and TS runtime code can import
// it directly. Conformance tests lock these constants to the TS sources.
const JSON_SCHEMA_VERSION = "2.0.0";
const ACCOUNT_FILE_VERSION = 3;
const WORKFLOW_SNAPSHOT_VERSION = "2";
const WORKFLOW_SECRET_RECORD_VERSION = "1";

export {
  JSON_SCHEMA_VERSION as PROTOCOL_JSON_SCHEMA_VERSION,
  ACCOUNT_FILE_VERSION as PROTOCOL_ACCOUNT_FILE_VERSION,
  WORKFLOW_SNAPSHOT_VERSION as PROTOCOL_WORKFLOW_SNAPSHOT_VERSION,
  WORKFLOW_SECRET_RECORD_VERSION as PROTOCOL_WORKFLOW_SECRET_RECORD_VERSION,
};

export const CLI_PROTOCOL_PROFILE = Object.freeze({
  family: "privacy-pools",
  generation: "v1",
  profile: "privacy-pools-v1",
  displayName: "Privacy Pools v1",
  coreSdkPackage: "@0xbow/privacy-pools-core-sdk",
  coreSdkVersion: "1.2.0",
  supportedChainPolicy: "cli-curated",
  notes: [
    "Chain support is a CLI-curated subset of the broader website deployment catalog.",
    "Proof, signer, mnemonic, workflow, migration, relayer, and transaction-composition logic stays in JS.",
  ],
});

export function buildRuntimeCompatibilityDescriptor(cliVersion) {
  return {
    cliVersion,
    jsonSchemaVersion: JSON_SCHEMA_VERSION,
    accountFileVersion: ACCOUNT_FILE_VERSION,
    workflowSnapshotVersion: WORKFLOW_SNAPSHOT_VERSION,
    workflowSecretVersion: WORKFLOW_SECRET_RECORD_VERSION,
    runtimeVersion: CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
    workerProtocolVersion: CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
    manifestVersion: CURRENT_RUNTIME_DESCRIPTOR.manifestVersion,
    nativeBridgeVersion: CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
  };
}
