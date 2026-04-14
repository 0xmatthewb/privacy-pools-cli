import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { withProofProgress, withSpinnerProgress, resetFirstRunMessage } from "../../src/utils/proof-progress.ts";

function mockSpinner(): { text: string; isSpinning: boolean; render: () => void } {
  return {
    text: "",
    isSpinning: true,
    render: () => {},
  };
}

describe("withProofProgress", () => {
  beforeEach(() => {
    resetFirstRunMessage();
  });

  afterEach(() => {
    jest.useRealTimers();
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
    expect(captured).toBe("Generating... (0s) - build witness");
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
    jest.useFakeTimers();
    const spin = mockSpinner();
    const result = await withProofProgress(spin as any, "Quick", async () => "ok");
    expect(result).toBe("ok");
    // If interval was not cleared, spin.text would keep changing.
    // Advance past the 1s interval to verify no lingering callback fires.
    const textAfter = spin.text;
    jest.advanceTimersByTime(1100);
    expect(spin.text).toBe(textAfter);
    jest.useRealTimers();
  });

  test("completes cleanly without lingering intervals on error", async () => {
    jest.useFakeTimers();
    const spin = mockSpinner();
    try {
      await withProofProgress(spin as any, "Fail", async () => {
        throw new Error("fail");
      });
    } catch {
      // expected
    }
    const textAfter = spin.text;
    jest.advanceTimersByTime(1100);
    expect(spin.text).toBe(textAfter);
    jest.useRealTimers();
  });

  test("updates spinner text with elapsed time after delay", async () => {
    jest.useFakeTimers();
    const spin = mockSpinner();
    const promise = withProofProgress(spin as any, "Proving", async () => {
      await new Promise((r) => setTimeout(r, 1050));
      return "proof";
    });
    // Advance past both the 1000ms interval and the 1050ms inner timeout.
    jest.advanceTimersByTime(1100);
    const result = await promise;
    expect(result).toBe("proof");
    expect(spin.text).toMatch(/Proving\.\.\. \(\d+s\)/);
    jest.useRealTimers();
  });

  test("manual proof checkpoints override elapsed-time guesses", async () => {
    const spin = mockSpinner();
    const seen: string[] = [];

    await withProofProgress(spin as any, "Generating", async (progress) => {
      progress.markArtifactVerificationPhase();
      seen.push(spin.text);
      progress.markBuildWitnessPhase();
      seen.push(spin.text);
      progress.markGenerateProofPhase();
      seen.push(spin.text);
      progress.markFinalizeProofPhase();
      seen.push(spin.text);
      progress.markVerifyProofPhase();
      seen.push(spin.text);
      return "done";
    });

    expect(seen).toEqual([
      "Generating... (0s) - verify circuits if needed",
      "Generating... (0s) - build witness",
      "Generating... (0s) - generate proof",
      "Generating... (0s) - finalize proof",
      "Generating... (0s) - verify proof",
    ]);
  });

  test("first call shows the initial verification phase immediately", async () => {
    const spin = mockSpinner();
    let captured = "";
    await withProofProgress(spin as any, "Generating", async () => {
      captured = spin.text;
      return "done";
    });
    expect(captured).toBe("Generating... (0s) - verify circuits if needed");
  });

  test("second call omits bundled circuit verification message", async () => {
    const spin1 = mockSpinner();
    await withProofProgress(spin1 as any, "First", async () => "ok");

    const spin2 = mockSpinner();
    let captured = "";
    await withProofProgress(spin2 as any, "Second", async () => {
      captured = spin2.text;
      return "ok";
    });
    expect(captured).toBe("Second... (0s) - build witness");
    expect(captured).not.toContain("verify circuits");
  });

  test("manual verification checkpoints stay suppressed after the first run", async () => {
    const warmSpin = mockSpinner();
    await withProofProgress(warmSpin as any, "Warm", async () => "ok");

    const spin = mockSpinner();
    let captured = "";
    await withProofProgress(spin as any, "Second", async (progress) => {
      progress.markArtifactVerificationPhase();
      captured = spin.text;
      return "ok";
    });

    expect(captured).toBe("Second... (0s) - build witness");
    expect(captured).not.toContain("verify circuits");
  });

  test("manual proof-verification checkpoints show the final verification phase", async () => {
    const spin = mockSpinner();
    let captured = "";

    await withProofProgress(spin as any, "Generating", async (progress) => {
      progress.markVerifyProofPhase();
      captured = spin.text;
      return "ok";
    });

    expect(captured).toBe("Generating... (0s) - verify proof");
  });
});

describe("withSpinnerProgress", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("returns wrapped function result", async () => {
    const spin = mockSpinner();
    const result = await withSpinnerProgress(spin as any, "Sync", async () => 42);
    expect(result).toBe(42);
  });

  test("sets initial spinner text without first-run logic", async () => {
    const spin = mockSpinner();
    let captured = "";
    await withSpinnerProgress(spin as any, "Syncing", async () => {
      captured = spin.text;
      return "done";
    });
    expect(captured).toBe("Syncing...");
    expect(captured).not.toContain("first proof");
    expect(captured).not.toContain("circuit");
  });

  test("re-throws errors from wrapped function", async () => {
    const spin = mockSpinner();
    await expect(
      withSpinnerProgress(spin as any, "Sync", async () => {
        throw new Error("sync failed");
      })
    ).rejects.toThrow("sync failed");
  });

  test("clears interval on success", async () => {
    jest.useFakeTimers();
    const spin = mockSpinner();
    const result = await withSpinnerProgress(spin as any, "Quick", async () => "ok");
    expect(result).toBe("ok");
    const textAfter = spin.text;
    jest.advanceTimersByTime(1100);
    expect(spin.text).toBe(textAfter);
    jest.useRealTimers();
  });

  test("clears interval on error", async () => {
    jest.useFakeTimers();
    const spin = mockSpinner();
    try {
      await withSpinnerProgress(spin as any, "Fail", async () => {
        throw new Error("fail");
      });
    } catch {
      // expected
    }
    const textAfter = spin.text;
    jest.advanceTimersByTime(1100);
    expect(spin.text).toBe(textAfter);
    jest.useRealTimers();
  });

  test("updates spinner text with elapsed time after delay", async () => {
    jest.useFakeTimers();
    const spin = mockSpinner();
    const promise = withSpinnerProgress(spin as any, "Syncing", async () => {
      await new Promise((r) => setTimeout(r, 1050));
      return "synced";
    });
    jest.advanceTimersByTime(1100);
    const result = await promise;
    expect(result).toBe("synced");
    expect(spin.text).toMatch(/Syncing\.\.\. \(\d+s\)/);
    jest.useRealTimers();
  });

  test("shows 'still working' message after 30s (not 'almost there')", async () => {
    jest.useFakeTimers();
    const spin = mockSpinner();
    const promise = withSpinnerProgress(spin as any, "Syncing", async () => {
      await new Promise((r) => setTimeout(r, 31_000));
      return "done";
    });
    jest.advanceTimersByTime(31_000);
    const result = await promise;
    expect(result).toBe("done");
    expect(spin.text).toContain("still working");
    expect(spin.text).not.toContain("almost there");
  });

  test("does not call render when the spinner is not active", async () => {
    jest.useFakeTimers();
    const render = jest.fn();
    const spin = {
      text: "",
      isSpinning: false,
      render,
    };

    const promise = withSpinnerProgress(spin as any, "Syncing", async () => {
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      return "done";
    });

    jest.advanceTimersByTime(11_000);
    await expect(promise).resolves.toBe("done");
    expect(spin.text).toContain("this may take a moment");
    expect(render).not.toHaveBeenCalled();
  });
});
