import { beforeEach, describe, expect, test } from "bun:test";
import { withProofProgress, resetFirstRunMessage } from "../../src/utils/proof-progress.ts";

function mockSpinner(): { text: string } {
  return { text: "" };
}

describe("withProofProgress", () => {
  beforeEach(() => {
    resetFirstRunMessage();
  });

  test("returns wrapped function result", async () => {
    const spin = mockSpinner();
    const result = await withProofProgress(spin as any, "Test", async () => 42);
    expect(result).toBe(42);
  });

  test("returns complex objects from wrapped function", async () => {
    const spin = mockSpinner();
    const obj = { proof: "0xabc", verified: true };
    const result = await withProofProgress(spin as any, "Prove", async () => obj);
    expect(result).toEqual(obj);
  });

  test("sets initial spinner text (non-first-run)", async () => {
    const spin0 = mockSpinner();
    // Consume the first-run message so we test the steady-state label.
    await withProofProgress(spin0 as any, "Warm", async () => "ok");

    const spin = mockSpinner();
    let captured = "";
    await withProofProgress(spin as any, "Generating", async () => {
      captured = spin.text;
      return "done";
    });
    expect(captured).toBe("Generating...");
  });

  test("re-throws errors from wrapped function", async () => {
    const spin = mockSpinner();
    await expect(
      withProofProgress(spin as any, "Test", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  test("preserves error type when re-throwing", async () => {
    const spin = mockSpinner();
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    try {
      await withProofProgress(spin as any, "Test", async () => {
        throw new CustomError("custom boom");
      });
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(CustomError);
      expect((err as Error).message).toBe("custom boom");
    }
  });

  test("completes cleanly without lingering intervals on success", async () => {
    const spin = mockSpinner();
    const result = await withProofProgress(spin as any, "Quick", async () => "ok");
    expect(result).toBe("ok");
    // If interval was not cleared, spin.text would keep changing.
    // Capture the text after completion and verify it stays stable.
    // Use 1100ms — slightly above the 1s interval — to avoid flakiness.
    const textAfter = spin.text;
    await new Promise((r) => setTimeout(r, 1100));
    expect(spin.text).toBe(textAfter);
  });

  test("completes cleanly without lingering intervals on error", async () => {
    const spin = mockSpinner();
    try {
      await withProofProgress(spin as any, "Fail", async () => {
        throw new Error("fail");
      });
    } catch {
      // expected
    }
    const textAfter = spin.text;
    await new Promise((r) => setTimeout(r, 1100));
    expect(spin.text).toBe(textAfter);
  });

  test("updates spinner text with elapsed time after delay", async () => {
    const spin = mockSpinner();
    const result = await withProofProgress(spin as any, "Proving", async () => {
      await new Promise((r) => setTimeout(r, 1050));
      return "proof";
    });
    expect(result).toBe("proof");
    // After ~1.05s the interval should have fired at least once, adding elapsed seconds.
    expect(spin.text).toMatch(/Proving\.\.\. \(\d+s\)/);
  });

  test("first call shows circuit download message", async () => {
    const spin = mockSpinner();
    let captured = "";
    await withProofProgress(spin as any, "Generating", async () => {
      captured = spin.text;
      return "done";
    });
    expect(captured).toBe("Generating... (first proof may download circuits)");
  });

  test("second call omits circuit download message", async () => {
    const spin1 = mockSpinner();
    await withProofProgress(spin1 as any, "First", async () => "ok");

    const spin2 = mockSpinner();
    let captured = "";
    await withProofProgress(spin2 as any, "Second", async () => {
      captured = spin2.text;
      return "ok";
    });
    expect(captured).toBe("Second...");
    expect(captured).not.toContain("first proof");
  });
});
