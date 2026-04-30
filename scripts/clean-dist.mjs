import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

// Remove dist and the TypeScript incremental cache together. tsc with
// `incremental: true` skips emit when the cache says outputs are current,
// so wiping dist alone leaves the next build with an empty dist directory.
for (const target of ["dist", ".tsbuildinfo"]) {
  rmSync(join(repoRoot, target), {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  });
}
