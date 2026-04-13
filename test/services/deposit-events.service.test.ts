import { describe, expect, test } from "bun:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import {
  CANONICAL_DEPOSIT_EVENT_SIGNATURE,
  SDK_COMPAT_DEPOSIT_EVENT_SIGNATURE,
  decodeDepositReceiptLog,
  normalizeDepositEventArgs,
} from "../../src/services/deposit-events.ts";

const DEPOSITOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;

function buildReceiptLog(
  signature: string,
  precommitmentField: "_precommitmentHash" | "_merkleRoot",
): { data: Hex; topics: readonly Hex[] } {
  const abiItem = parseAbiItem(signature);

  return {
    data: encodeAbiParameters(
      [
        { name: "_commitment", type: "uint256" },
        { name: "_label", type: "uint256" },
        { name: "_value", type: "uint256" },
        { name: precommitmentField, type: "uint256" },
      ],
      [11n, 22n, 33n, 44n],
    ),
    topics: encodeEventTopics({
      abi: [abiItem],
      eventName: "Deposited",
      args: { _depositor: DEPOSITOR },
    }) as readonly Hex[],
  };
}

describe("deposit event compatibility", () => {
  test("normalizes contract-truth args with _precommitmentHash", () => {
    expect(
      normalizeDepositEventArgs({
        _depositor: DEPOSITOR,
        _commitment: 11n,
        _label: 22n,
        _value: 33n,
        _precommitmentHash: 44n,
      }),
    ).toEqual({
      depositor: DEPOSITOR.toLowerCase(),
      commitment: 11n,
      label: 22n,
      value: 33n,
      precommitment: 44n,
    });
  });

  test("normalizes installed-sdk args with _merkleRoot", () => {
    expect(
      normalizeDepositEventArgs({
        _depositor: DEPOSITOR,
        _commitment: 11n,
        _label: 22n,
        _value: 33n,
        _merkleRoot: 44n,
      }),
    ).toEqual({
      depositor: DEPOSITOR.toLowerCase(),
      commitment: 11n,
      label: 22n,
      value: 33n,
      precommitment: 44n,
    });
  });

  test("fails closed when neither precommitment variant is present", () => {
    expect(() =>
      normalizeDepositEventArgs({
        _depositor: DEPOSITOR,
        _commitment: 11n,
        _label: 22n,
        _value: 33n,
      }),
    ).toThrow("Malformed deposit log");
  });

  test("decodes canonical receipt logs", () => {
    expect(
      decodeDepositReceiptLog(
        buildReceiptLog(
          CANONICAL_DEPOSIT_EVENT_SIGNATURE,
          "_precommitmentHash",
        ),
      ),
    ).toEqual({
      depositor: DEPOSITOR.toLowerCase(),
      commitment: 11n,
      label: 22n,
      value: 33n,
      precommitment: 44n,
    });
  });

  test("decodes installed-sdk-compatible receipt logs", () => {
    expect(
      decodeDepositReceiptLog(
        buildReceiptLog(
          SDK_COMPAT_DEPOSIT_EVENT_SIGNATURE,
          "_merkleRoot",
        ),
      ),
    ).toEqual({
      depositor: DEPOSITOR.toLowerCase(),
      commitment: 11n,
      label: 22n,
      value: 33n,
      precommitment: 44n,
    });
  });
});
