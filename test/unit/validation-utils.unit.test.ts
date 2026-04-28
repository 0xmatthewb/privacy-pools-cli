import { afterEach, describe, expect, mock, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

let importCounter = 0;
const realViem = captureModuleExports(await import("viem"));
const realViemChains = captureModuleExports(await import("viem/chains"));
const realViemEns = captureModuleExports(await import("viem/ens"));

async function importValidationModule() {
  importCounter += 1;
  return import(`../../src/utils/validation.ts?validation-utils=${importCounter}`);
}

afterEach(() => {
  restoreModuleImplementations([
    ["viem", realViem],
    ["viem/chains", realViemChains],
    ["viem/ens", realViemEns],
  ]);
});

describe("validation utilities", () => {
  test("resolveChain normalizes defaults and unknown-chain guidance", async () => {
    const { resolveChain } = await importValidationModule();

    expect(resolveChain(undefined, "  Ethereum  ").name).toBe("mainnet");
    expect(resolveChain("OP MAINNET").name).toBe("optimism");

    let error: unknown;
    try {
      resolveChain("mainnett");
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(CLIError);
    expect((error as CLIError).code).toBe("INPUT_UNKNOWN_CHAIN");
    expect((error as CLIError).hint).toContain('Did you mean "mainnet"?');
  });

  test("validateAddress distinguishes malformed, checksum, and zero-address failures", async () => {
    const { validateAddress } = await importValidationModule();

    expect(() => validateAddress("not-an-address")).toThrow(
      new CLIError(
        "Invalid Ethereum address.",
        "INPUT",
        "Provide a 0x-prefixed Ethereum address or an ENS name (for example: vitalik.eth).",
        "INPUT_BAD_ADDRESS",
      ),
    );
    expect(() =>
      validateAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4"),
    ).toThrow(
      new CLIError(
        "Invalid Ethereum address checksum.",
        "INPUT",
        "Provide an address with the correct EIP-55 checksum, or use the all-lowercase / all-uppercase form.",
        "INPUT_ADDRESS_CHECKSUM_INVALID",
      ),
    );
    expect(() =>
      validateAddress("0x0000000000000000000000000000000000000000", "Recipient"),
    ).toThrow(
      new CLIError(
        "Recipient cannot be the zero address.",
        "INPUT",
        "Provide a non-zero destination address. Using 0x000...000 would burn funds.",
        "INPUT_BAD_ADDRESS",
      ),
    );
  });

  test("parseAmount covers precision failures, negative opt-in, and parseUnits guardrails", async () => {
    const { parseAmount, validatePositive } = await importValidationModule();

    expect(parseAmount("-1.5", 18, { allowNegative: true })).toBe(
      -1500000000000000000n,
    );
    expect(() => parseAmount("1.234", 2)).toThrow(
      new CLIError(
        "Invalid amount precision: 1.234",
        "INPUT",
        "Amount supports up to 2 decimal places for this asset.",
        "INPUT_INVALID_AMOUNT",
      ),
    );
    mock.module("viem", () => ({
      ...realViem,
      parseUnits: () => {
        throw new Error("parseUnits exploded");
      },
    }));
    const { parseAmount: parseAmountWithBrokenUnits } = await importValidationModule();
    expect(() => parseAmountWithBrokenUnits("1", 18)).toThrow(
      new CLIError(
        "Invalid amount: 1",
        "INPUT",
        "Amount must be a valid non-negative number (e.g., 0.1, 10, 1000.50)",
        "INPUT_INVALID_AMOUNT",
      ),
    );
    expect(() => validatePositive(0n, "Withdrawal amount")).toThrow(
      new CLIError(
        "Withdrawal amount must be greater than zero.",
        "INPUT",
        "Enter a positive number (e.g. 0.1, 10).",
        "INPUT_INVALID_AMOUNT",
      ),
    );
  });

  test("lookupEnsNameForAddress returns verified names and degrades cleanly on misses", async () => {
    const createPublicClientMock = mock(() => ({
      getEnsName: async ({ address }: { address: string }) => {
        if (address.endsWith("55")) return "alice.eth";
        if (address.endsWith("66")) return null;
        throw new Error("rpc offline");
      },
      getEnsAddress: async ({ name }: { name: string }) => {
        if (name === "normalized:alice.eth") {
          return "0x5555555555555555555555555555555555555555";
        }
        return "0x7777777777777777777777777777777777777777";
      },
    }));

    mock.module("viem", () => ({
      ...realViem,
      createPublicClient: createPublicClientMock,
      http: () => "mock-transport",
    }));
    mock.module("viem/chains", () => ({
      mainnet: { id: 1, name: "Ethereum" },
    }));
    mock.module("viem/ens", () => ({
      normalize: (value: string) => `normalized:${value}`,
    }));

    const { lookupEnsNameForAddress } = await importValidationModule();

    await expect(
      lookupEnsNameForAddress("0x5555555555555555555555555555555555555555"),
    ).resolves.toBe("alice.eth");
    await expect(
      lookupEnsNameForAddress("0x6666666666666666666666666666666666666666"),
    ).resolves.toBeUndefined();
    await expect(
      lookupEnsNameForAddress("0x8888888888888888888888888888888888888888"),
    ).resolves.toBeUndefined();
  });

  test("resolveAddressOrEns uses the ENS client for dotted names and fails closed on unresolved names", async () => {
    const createPublicClientMock = mock(() => ({
      getEnsAddress: async ({ name }: { name: string }) => {
        if (name === "normalized:alice.eth") {
          return "0x5555555555555555555555555555555555555555";
        }
        return null;
      },
    }));

    mock.module("viem", () => ({
      ...realViem,
      createPublicClient: createPublicClientMock,
      http: () => "mock-transport",
    }));
    mock.module("viem/chains", () => ({
      mainnet: { id: 1, name: "Ethereum" },
    }));
    mock.module("viem/ens", () => ({
      normalize: (value: string) => `normalized:${value}`,
    }));

    const { resolveAddressOrEns } = await importValidationModule();

    await expect(resolveAddressOrEns("alice.eth", "Recipient")).resolves.toEqual({
      address: "0x5555555555555555555555555555555555555555",
      ensName: "alice.eth",
    });
    await expect(resolveAddressOrEns("missing.eth", "Recipient")).rejects.toThrow(
      new CLIError(
        "Could not resolve ENS name: missing.eth.",
        "INPUT",
        "Verify the ENS name exists and try again. ENS resolution requires mainnet connectivity.",
        "INPUT_BAD_ADDRESS",
      ),
    );
    await expect(
      resolveAddressOrEns(
        "0x4444444444444444444444444444444444444444",
        "Recipient",
      ),
    ).resolves.toEqual({
      address: "0x4444444444444444444444444444444444444444",
    });
  });
});
