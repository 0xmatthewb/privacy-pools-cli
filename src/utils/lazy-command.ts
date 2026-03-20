type LazyCommandHandler = (...args: any[]) => void | Promise<void>;

function resolveHandler(
  module: Record<string, unknown>,
  exportName: string,
): LazyCommandHandler {
  const candidate = module[exportName];
  if (typeof candidate !== "function") {
    throw new Error(`Lazy command export "${exportName}" was not a function.`);
  }
  return candidate as LazyCommandHandler;
}

export function createLazyAction(
  load: () => Promise<Record<string, unknown>>,
  exportName: string,
): (...args: any[]) => Promise<void> {
  let handlerPromise: Promise<LazyCommandHandler> | null = null;

  return async (...args: any[]) => {
    if (!handlerPromise) {
      handlerPromise = load().then((module) =>
        resolveHandler(module, exportName),
      );
    }

    const handler = await handlerPromise;
    return handler(...args);
  };
}
