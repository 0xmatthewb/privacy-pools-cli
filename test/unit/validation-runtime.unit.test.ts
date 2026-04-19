import { afterEach, describe, expect, mock, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";
import {
  lookupEnsNameForAddress,
  parseAmount,
  resolveAddressOrEns,
  validateAddress,
  validatePositive,
} from "../../src/utils/validation.ts";

afterEach(() => {
  mock.restore();
});

describe("validation runtime coverage", () => {
  test("resolveAddressOrEns returns a direct address without ENS lookups", async () => {
    await expect(
      resolveAddressOrEns(
        "0x4444444444444444444444444444444444444444",
        "Recipient",
      ),
    ).resolves.toEqual({
      address: "0x4444444444444444444444444444444444444444",
    });
  });

  test("resolveAddressOrEns resolves ENS names through the mainnet client", async () => {
    const realViem = await import("viem");
    const createPublicClientMock = mock(() => ({
      getEnsAddress: async ({ name }: { name: string }) => {
        expect(name).toBe("normalized:alice.eth");
        return "0x5555555555555555555555555555555555555555";
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

    await expect(resolveAddressOrEns("alice.eth", "Recipient")).resolves.toEqual({
      address: "0x5555555555555555555555555555555555555555",
      ensName: "alice.eth",
    });
    expect(createPublicClientMock).toHaveBeenCalledTimes(1);
  });

  test("lookupEnsNameForAddress returns verified reverse ENS names", async () => {
    const realViem = await import("viem");
    const createPublicClientMock = mock(() => ({
      getEnsName: async ({ address }: { address: string }) => {
        expect(address).toBe("0x5555555555555555555555555555555555555555");
        return "alice.eth";
      },
      getEnsAddress: async ({ name }: { name: string }) => {
        expect(name).toBe("normalized:alice.eth");
        return "0x5555555555555555555555555555555555555555";
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

    await expect(
      lookupEnsNameForAddress("0x5555555555555555555555555555555555555555"),
    ).resolves.toBe("alice.eth");
    expect(createPublicClientMock).toHaveBeenCalledTimes(1);
  });

  test("resolveAddressOrEns converts ENS lookup failures into a CLIError", async () => {
    const realViem = await import("viem");

    mock.module("viem", () => ({
      ...realViem,
      createPublicClient: () => ({
        getEnsAddress: async () => {
          throw new Error("rpc offline");
        },
      }),
      http: () => "mock-transport",
    }));
    mock.module("viem/chains", () => ({
      mainnet: { id: 1, name: "Ethereum" },
    }));
    mock.module("viem/ens", () => ({
      normalize: (value: string) => value,
    }));

    await expect(resolveAddressOrEns("missing.eth", "Recipient")).rejects.toThrow(
      new CLIError(
        "Invalid address or ENS name.",
        "INPUT",
        "Verify the name exists and try again. ENS resolution requires mainnet connectivity.",
        "INPUT_BAD_ADDRESS",
      ),
    );
  });

  test("resolveAddressOrEns fails closed when ENS lookup returns no address", async () => {
    const realViem = await import("viem");

    mock.module("viem", () => ({
      ...realViem,
      createPublicClient: () => ({
        getEnsAddress: async () => null,
      }),
      http: () => "mock-transport",
    }));
    mock.module("viem/chains", () => ({
      mainnet: { id: 1, name: "Ethereum" },
    }));
    mock.module("viem/ens", () => ({
      normalize: (value: string) => value,
    }));

    await expect(resolveAddressOrEns("unknown.eth", "Recipient")).rejects.toThrow(
      new CLIError(
        "Invalid address or ENS name.",
        "INPUT",
        "Verify the name exists and try again. ENS resolution requires mainnet connectivity.",
        "INPUT_BAD_ADDRESS",
      ),
    );
  });

  test("resolveAddressOrEns falls back to address validation for non-ENS strings", async () => {
    await expect(
      resolveAddressOrEns("not-an-address", "Recipient"),
    ).rejects.toThrow(
      new CLIError(
        "Invalid address or ENS name.",
        "INPUT",
        "Provide a 0x-prefixed Ethereum address or an ENS name (for example: vitalik.eth).",
        "INPUT_BAD_ADDRESS",
      ),
    );
  });

  test("validateAddress rejects the zero address with the burn-funds hint", () => {
    expect(() =>
      validateAddress("0x0000000000000000000000000000000000000000", "Recipient"),
    ).toThrow(
      new CLIError(
        "Recipient cannot be the zero address.",
        "INPUT",
        "Provide a non-zero destination address. Using 0x000...000 would burn funds.",
      ),
    );
  });

  test("validateAddress surfaces checksum-specific guidance for mixed-case addresses", () => {
    expect(() =>
      validateAddress(
        "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4",
        "Recipient",
      ),
    ).toThrow(
      new CLIError(
        "Invalid address or ENS name.",
        "INPUT",
        "Provide an address with the correct EIP-55 checksum, or use the all-lowercase / all-uppercase form.",
        "INPUT_ADDRESS_CHECKSUM_INVALID",
      ),
    );
  });

  test("parseAmount supports negative values only when explicitly allowed", () => {
    expect(parseAmount("-1.5", 18, { allowNegative: true })).toBe(
      -1500000000000000000n,
    );
    expect(() => parseAmount("-1.5", 18)).toThrow(CLIError);
  });

  test("validatePositive preserves the caller label in the CLI error", () => {
    expect(() => validatePositive(0n, "Withdrawal amount")).toThrow(
      new CLIError(
        "Withdrawal amount must be greater than zero.",
        "INPUT",
        "Enter a positive number (e.g. 0.1, 10).",
      ),
    );
  });
});
