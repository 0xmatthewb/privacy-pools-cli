import { expect } from "bun:test";

export interface StrictStubCall<TArgs extends unknown[]> {
  label: string;
  args: TArgs;
}

interface StrictStubExpectation<TArgs extends unknown[], TResult> {
  label: string;
  match?: (...args: TArgs) => boolean;
  impl: (...args: TArgs) => TResult;
  used: boolean;
}

export interface StrictStubRegistry<TArgs extends unknown[], TResult> {
  expectCall(
    label: string,
    impl: (...args: TArgs) => TResult,
    options?: { match?: (...args: TArgs) => boolean; times?: number },
  ): void;
  createStub(): (...args: TArgs) => TResult;
  assertConsumed(): void;
  reset(): void;
  readonly calls: readonly StrictStubCall<TArgs>[];
}

export function createStrictStubRegistry<TArgs extends unknown[], TResult>(
  name: string,
): StrictStubRegistry<TArgs, TResult> {
  const expectations: StrictStubExpectation<TArgs, TResult>[] = [];
  const calls: StrictStubCall<TArgs>[] = [];

  return {
    expectCall(label, impl, options = {}) {
      const times = Math.max(1, options.times ?? 1);
      for (let index = 0; index < times; index += 1) {
        expectations.push({
          label,
          match: options.match,
          impl,
          used: false,
        });
      }
    },
    createStub() {
      return (...args: TArgs) => {
        const expectation = expectations.find(
          (candidate) =>
            !candidate.used && (candidate.match?.(...args) ?? true),
        );

        if (!expectation) {
          throw new Error(
            `[${name}] unexpected call with args: ${JSON.stringify(args)}`,
          );
        }

        expectation.used = true;
        calls.push({ label: expectation.label, args });
        return expectation.impl(...args);
      };
    },
    assertConsumed() {
      const unused = expectations
        .filter((expectation) => !expectation.used)
        .map((expectation) => expectation.label);

      expect(
        unused,
        `[${name}] unused expectations: ${unused.join(", ")}`,
      ).toEqual([]);
    },
    reset() {
      expectations.splice(0, expectations.length);
      calls.splice(0, calls.length);
    },
    get calls() {
      return calls;
    },
  };
}
