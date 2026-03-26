import { mock } from "bun:test";

export type ModuleMockFactory = () => unknown;
export type ModuleRestoreDefinition = readonly [string, unknown];

/**
 * Capture a shallow snapshot of a module's current exports before Bun rewires
 * live bindings via mock.module().
 */
export function captureModuleExports<T extends Record<string, unknown>>(
  moduleExports: T,
): T {
  return { ...moduleExports };
}

export function installModuleMocks(
  definitions: ReadonlyArray<readonly [string, ModuleMockFactory]>,
): void {
  for (const [path, factory] of definitions) {
    mock.module(path, factory);
  }
}

/**
 * Re-applies the original exports for modules previously replaced with
 * `mock.module()`. This does not rewind import-time side effects, but it does
 * push Bun's live bindings back to the captured real modules for later tests.
 */
export function restoreModuleImplementations(
  definitions: ReadonlyArray<ModuleRestoreDefinition>,
): void {
  for (const [path, exports] of definitions) {
    mock.module(path, () => exports);
  }
  mock.restore();
}

/**
 * Bun does not provide a safe in-process "unmock module" reset for mock.module().
 * This helper only restores spy/function mocks. Process-level isolation remains
 * the containment boundary for suites that replace modules.
 */
export function restoreMockFunctions(): void {
  mock.restore();
}

/**
 * @deprecated Use restoreMockFunctions(). This does not undo mock.module() replacements.
 */
export const restoreModuleMocks = restoreMockFunctions;
