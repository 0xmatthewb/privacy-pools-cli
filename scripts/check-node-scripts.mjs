import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scriptsRoot = join(root, "scripts");

function collectNodeScripts(dir) {
  const files = [];
  const queue = [dir];

  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".mjs")) {
        files.push(entryPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const files = collectNodeScripts(scriptsRoot);
if (files.length === 0) {
  fail("No Node .mjs scripts were found under scripts/.");
}

for (const filePath of files) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.error) {
    fail(`Failed to check ${filePath}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(
      `Node syntax check failed for ${filePath}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim(),
    );
  }
}

process.stdout.write(`checked ${files.length} node scripts\n`);
