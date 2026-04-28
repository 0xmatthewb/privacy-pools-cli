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
  return import(`../../src/utils/validation.ts?resolve-address=${importCounter}`);
}

afterEach(() => {
  restoreModuleImplementations([
    ["viem", realViem],
    ["viem/chains", realViemChains],
    ["viem/ens", realViemEns],
  ]);
});

describe("resolveAddressOrEns", () => {
  test("returns hex addresses immediately without ENS resolution", async () => {
    const { resolveAddressOrEns } = await importValidationModule();

    await expect(
      resolveAddressOrEns(
        "0x4444444444444444444444444444444444444444",
        "Recipient",
      ),
    ).resolves.toEqual({
      address: "0x4444444444444444444444444444444444444444",
    });
  });

  test("resolves ENS names through the mainnet client", async () => {
    const createPublicClientMock = mock(() => ({
      getEnsAddress: async ({ name }: { name: string }) => {
        expect(name).toBe("normalized:alice.eth");
        return "0x5555555555555555555555555555555555555555";
      },
    }));
    const httpMock = mock(() => "mock-transport");

    mock.module("viem", () => ({
      ...realViem,
      createPublicClient: createPublicClientMock,
      http: httpMock,
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
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(createPublicClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: expect.objectContaining({ id: 1 }),
        transport: "mock-transport",
      }),
    );
  });

  test("fails cleanly when an ENS name cannot be resolved", async () => {
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

    const { resolveAddressOrEns } = await importValidationModule();

    await expect(resolveAddressOrEns("missing.eth", "Recipient")).rejects.toThrow(
      new CLIError(
        "Could not resolve ENS name: missing.eth.",
        "INPUT",
        "Verify the ENS name exists and try again. ENS resolution requires mainnet connectivity.",
        "INPUT_BAD_ADDRESS",
      ),
    );
  });

  test("parseAmount accepts negative amounts only when explicitly allowed", async () => {
    const { parseAmount } = await importValidationModule();

    expect(parseAmount("-1.5", 18, { allowNegative: true })).toBe(
      -1500000000000000000n,
    );
    expect(() => parseAmount("-1.5", 18)).toThrow(CLIError);
  });
});
