/**
 * Shared source of truth for the active JS/native bridge. Future runtime
 * generations should update this descriptor first, then wire new handlers
 * around it.
 */

/** @type {"v1"} */
export const CURRENT_RUNTIME_VERSION = "v1";

/** @type {"1"} */
export const CURRENT_WORKER_PROTOCOL_VERSION = "1";

/** @type {"1"} */
export const CURRENT_MANIFEST_VERSION = "1";

/** @type {"1"} */
export const CURRENT_NATIVE_BRIDGE_VERSION = "1";

/** @type {"PRIVACY_POOLS_WORKER_REQUEST_B64"} */
export const CURRENT_RUNTIME_REQUEST_ENV = "PRIVACY_POOLS_WORKER_REQUEST_B64";

/** @type {"PRIVACY_POOLS_INTERNAL_JS_BRIDGE_B64"} */
export const CURRENT_NATIVE_JS_BRIDGE_ENV = "PRIVACY_POOLS_INTERNAL_JS_BRIDGE_B64";

/** @type {"./v1/worker-main.js"} */
export const CURRENT_RUNTIME_WORKER_ENTRY = "./v1/worker-main.js";

export const CURRENT_RUNTIME_DESCRIPTOR = Object.freeze({
  runtimeVersion: CURRENT_RUNTIME_VERSION,
  workerProtocolVersion: CURRENT_WORKER_PROTOCOL_VERSION,
  manifestVersion: CURRENT_MANIFEST_VERSION,
  nativeBridgeVersion: CURRENT_NATIVE_BRIDGE_VERSION,
  workerRequestEnv: CURRENT_RUNTIME_REQUEST_ENV,
  nativeBridgeEnv: CURRENT_NATIVE_JS_BRIDGE_ENV,
  workerEntryRelativePath: CURRENT_RUNTIME_WORKER_ENTRY,
});
