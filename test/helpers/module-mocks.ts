import { mock } from "bun:test";

export type ModuleMockFactory = () => unknown;

export function installModuleMocks(
  definitions: ReadonlyArray<readonly [string, ModuleMockFactory]>,
): void {
  for (const [path, factory] of definitions) {
    mock.module(path, factory);
  }
}

export function restoreModuleMocks(): void {
  mock.restore();
}
