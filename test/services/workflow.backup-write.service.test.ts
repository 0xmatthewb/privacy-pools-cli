import { afterEach, describe, expect, mock, test } from "bun:test";

describe("workflow backup write helper isolation", () => {
  afterEach(() => {
    mock.restore();
  });

  test("writePrivateTextFile rewraps non-Error write failures", async () => {
    const realConfig = await import("../../src/services/config.ts");

    mock.module("../../src/services/config.ts", () => ({
      ...realConfig,
      writePrivateFileAtomic: () => {
        throw "disk unavailable";
      },
    }));

    const { writePrivateTextFile } = await import(
      "../../src/services/workflow.ts?workflow-backup-write-failure"
    );

    expect(() =>
      writePrivateTextFile("/tmp/workflow-wallet.txt", "secret"),
    ).toThrow("Could not write workflow wallet backup");
  });
});
