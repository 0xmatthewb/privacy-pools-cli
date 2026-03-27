import { expect } from "bun:test";

export interface ExpectedUnsignedTransaction {
  chainId: number;
  to: string;
  value: string;
  description: string;
  data?: string;
  valueHex?: string;
  from?: null;
}

export function expectUnsignedTransactions(
  actual: Array<Record<string, unknown>>,
  expected: readonly ExpectedUnsignedTransaction[],
): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(
    expected.map((transaction) => expect.objectContaining(transaction)),
  );
}

export function expectPrintedRawTransactions(
  printRawTransactionsMock: {
    mock: { calls: Array<[Array<Record<string, unknown>>]> };
  },
  expected: readonly ExpectedUnsignedTransaction[],
): void {
  expect(printRawTransactionsMock).toHaveBeenCalledTimes(1);
  const printedTransactions = printRawTransactionsMock.mock.calls[0]?.[0] ?? [];
  expectUnsignedTransactions(printedTransactions, expected);
}
