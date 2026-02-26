import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { EXIT_CODES } from "../../src/utils/errors.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

const CONTRACT_DOC_PATH =
  `${CLI_ROOT}/docs/contracts/cli-json-contract.v1.0.0.json`;

interface ContractDoc {
  version: string;
  schemaVersion: string;
  exitCodes: Record<string, string>;
  shared?: {
    rawUnsignedTransaction?: Record<string, string>;
  };
  commands: Record<string, unknown>;
  unsignedCalldataABIs: Record<string, string>;
}

describe("external JSON contract doc conformance", () => {
  test("doc version is explicit and aligned with runtime schema version", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    expect(doc.version).toBe("1.2.0");
    expect(doc.schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });

  test("doc includes the full exit code map used by runtime", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    expect(doc.exitCodes).toEqual({
      "0": "SUCCESS",
      [String(EXIT_CODES.UNKNOWN)]: "UNKNOWN_ERROR",
      [String(EXIT_CODES.INPUT)]: "INPUT_ERROR",
      [String(EXIT_CODES.RPC)]: "RPC_ERROR",
      [String(EXIT_CODES.ASP)]: "ASP_ERROR",
      [String(EXIT_CODES.RELAYER)]: "RELAYER_ERROR",
      [String(EXIT_CODES.PROOF)]: "PROOF_ERROR",
      [String(EXIT_CODES.CONTRACT)]: "CONTRACT_ERROR",
    });
  });

  test("doc includes unsigned output variants and ABI signatures", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;

    expect("deposit" in doc.commands).toBe(true);
    expect("withdraw" in doc.commands).toBe(true);
    expect("ragequit" in doc.commands).toBe(true);

    expect(doc.unsignedCalldataABIs.depositNative).toContain("function deposit(uint256 _precommitment)");
    expect(doc.unsignedCalldataABIs.depositErc20).toContain("function deposit(address _asset");
    expect(doc.unsignedCalldataABIs.approveErc20).toContain("function approve(address spender");
    expect(doc.unsignedCalldataABIs.withdrawDirect).toContain("function withdraw(");
    expect(doc.unsignedCalldataABIs.withdrawRelayed).toContain("function relay(");
    expect(doc.unsignedCalldataABIs.ragequit).toContain("function ragequit(");
    expect(doc.shared?.rawUnsignedTransaction?.valueHex).toBe(
      "0x-prefixed-hex-quantity-wei"
    );
  });

  test("doc reflects current init/status/help machine envelopes", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const commands = doc.commands as Record<string, unknown>;

    const init = commands.init as { successFields?: Record<string, string> };
    expect(init.successFields?.defaultChain).toBe("string");
    expect(init.successFields?.signerKeySet).toBe("boolean");
    expect(init.successFields?.mnemonic).toContain("string?");

    const status = commands.status as { successFields?: Record<string, string> };
    expect(status.successFields?.selectedChain).toBe("string|null");

    const meta = commands.meta as Record<string, unknown>;
    expect(meta.helpEnvelope).toBeTruthy();
    expect(meta.versionEnvelope).toBeTruthy();
  });
});
