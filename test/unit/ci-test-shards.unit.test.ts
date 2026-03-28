import { describe, expect, test } from "bun:test";
import {
  buildFileShards,
  collectLinuxCoreTestFiles,
  resolveFileWeight,
} from "../../scripts/ci/lib.mjs";

describe("ci test shards", () => {
  test("linux-core shard discovery excludes acceptance-replaced integration files and keeps isolated suites", () => {
    const files = collectLinuxCoreTestFiles();

    expect(files).toContain("./test/acceptance/status-init.acceptance.test.ts");
    expect(files).toContain(
      "./test/acceptance/agent-improvements.acceptance.test.ts",
    );
    expect(files).toContain("./test/acceptance/transaction-inputs.acceptance.test.ts");
    expect(files).toContain("./test/acceptance/no-sync.acceptance.test.ts");
    expect(files).toContain("./test/services/contracts.service.test.ts");
    expect(files).toContain("./test/integration/cli-flow.integration.test.ts");
    expect(files).not.toContain("./test/integration/cli-status-init.integration.test.ts");
    expect(files).not.toContain("./test/integration/cli-output-mode.integration.test.ts");
    expect(files).not.toContain(
      "./test/integration/cli-agent-improvements.integration.test.ts",
    );
    expect(files).not.toContain("./test/integration/cli-completion.integration.test.ts");
    expect(files).not.toContain("./test/integration/cli-stats.integration.test.ts");
    expect(files).not.toContain("./test/integration/cli-activity.integration.test.ts");
    expect(files).not.toContain(
      "./test/integration/cli-transaction-inputs.integration.test.ts",
    );
    expect(files).not.toContain("./test/integration/cli-no-sync.integration.test.ts");
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
    expect(resolveFileWeight("./test/unit/withdraw-command-handler.unit.test.ts")).toBe(
      180,
    );
  });
});
