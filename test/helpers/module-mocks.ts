import { mock } from "bun:test";

export type ModuleMockFactory = () => unknown;

export function installModuleMocks(
  definitions: ReadonlyArray<readonly [string, ModuleMockFactory]>,
): void {
  for (const [path, factory] of definitions) {
    mock.module(path, factory);
  }
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
