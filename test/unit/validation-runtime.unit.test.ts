import { afterEach, describe, expect, mock, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";
import { resolveAddressOrEns } from "../../src/utils/validation.ts";

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
        'Could not resolve ENS name "missing.eth".',
        "INPUT",
        "Verify the name exists and try again. ENS resolution requires mainnet connectivity.",
      ),
    );
  });

  test("resolveAddressOrEns falls back to address validation for non-ENS strings", async () => {
    await expect(
      resolveAddressOrEns("not-an-address", "Recipient"),
    ).rejects.toThrow(
      new CLIError(
        "Recipient is not a valid Ethereum address: not-an-address",
        "INPUT",
        "Provide a 0x-prefixed, 42-character hex address (e.g. 0xAbC...123).",
      ),
    );
  });
});
