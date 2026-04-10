export {
  buildCapabilitiesPayload,
  buildCommandDescriptor,
  CAPABILITIES_COMMAND_ORDER,
  CAPABILITY_ENV_VARS,
  CAPABILITY_EXIT_CODES,
  CAPABILITIES_SCHEMAS,
  COMMAND_PATHS,
  getDocumentedAgentMarkers,
  getCommandExecutionMetadata,
  getCommandMetadata,
  GLOBAL_FLAG_METADATA,
  listCommandPaths,
  resolveCommandPath,
  type CommandMetadata,
  type CommandPath,
  type GlobalFlagMetadata,
} from "./command-discovery-metadata.js";

export { COMMAND_CATALOG as COMMAND_METADATA } from "./command-catalog.js";
