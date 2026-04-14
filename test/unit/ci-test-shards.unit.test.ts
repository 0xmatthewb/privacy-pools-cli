import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildFileShards,
  collectLinuxCoreTestFiles,
  resolveFileWeight,
} from "../../scripts/ci/lib.mjs";

describe("ci test shards", () => {
  test("linux-core shard discovery keeps canonical acceptance coverage and excludes dedicated smoke lanes", () => {
    const files = collectLinuxCoreTestFiles();

    expect(files).toContain("./test/acceptance/status-init.acceptance.test.ts");
    expect(files).toContain(
      "./test/acceptance/agent-improvements.acceptance.test.ts",
    );
    expect(files).toContain("./test/acceptance/transaction-inputs.acceptance.test.ts");
    expect(files).toContain("./test/acceptance/no-sync.acceptance.test.ts");
    expect(files).toContain("./test/services/contracts.service.test.ts");
    expect(files).toContain("./test/integration/cli-flow.integration.test.ts");
    expect(files).not.toContain(
      "./test/integration/cli-packaged-smoke.integration.test.ts",
    );
    expect(files).not.toContain(
      "./test/integration/cli-native-package-smoke.integration.test.ts",
    );
    expect(files).not.toContain("./test/integration/cli-native-machine-contract.integration.test.ts");
    expect(files).not.toContain("./test/integration/cli-native-routing-smoke.integration.test.ts");
    expect(files).not.toContain("./test/integration/cli-native-human-output.integration.test.ts");
  });

  test("shard builder covers every file exactly once", () => {
    const files = collectLinuxCoreTestFiles();
    const shards = buildFileShards(files, 3);
    const covered = shards.flatMap((shard) => shard.files);

    expect(shards).toHaveLength(3);
    expect(new Set(covered)).toEqual(new Set(files));
    expect(covered).toHaveLength(files.length);
  });

  test("configured shard weights override raw file length for known heavy suites", () => {
    for (const filePath of [
      "./test/unit/withdraw-command-handler.relayed.unit.test.ts",
      "./test/unit/accounts-command-readonly.unit.test.ts",
    ]) {
      const rawLineCount = readFileSync(resolve(filePath), "utf8").split("\n").length;
      expect(resolveFileWeight(filePath)).not.toBe(rawLineCount);
      expect(resolveFileWeight(filePath)).toBeGreaterThan(0);
    }
  });
});
