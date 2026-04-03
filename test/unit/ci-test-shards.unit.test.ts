import { describe, expect, test } from "bun:test";
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
    expect(files).not.toContain("./test/integration/cli-native-shell.integration.test.ts");
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
    expect(
      resolveFileWeight("./test/unit/withdraw-command-handler.relayed.unit.test.ts"),
    ).toBe(85);
    expect(resolveFileWeight("./test/unit/accounts-command-readonly.unit.test.ts")).toBe(
      55,
    );
  });
});
