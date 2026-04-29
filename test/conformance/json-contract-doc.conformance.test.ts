import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  JSON_SCHEMA_VERSION,
  jsonContractDocRelativePath,
} from "../../src/utils/json.ts";
import { EXIT_CODES } from "../../src/utils/errors.ts";
import { COMMAND_PATHS } from "../../src/utils/command-catalog.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

const CONTRACT_DOC_PATH = `${CLI_ROOT}/${jsonContractDocRelativePath()}`;
const CURRENT_CONTRACT_DOC_PATH = `${CLI_ROOT}/docs/contracts/cli-json-contract.current.json`;
const SCHEMA_VERSION_INTENT_PATH = `${CLI_ROOT}/docs/contracts/schema-version-intent.json`;

interface ContractDoc {
  version: string;
  schemaVersion: string;
  exitCodes: Record<string, string>;
  generated?: unknown;
  shared?: {
    rawUnsignedTransaction?: Record<string, string>;
  };
  commands: Record<string, unknown>;
  unsignedCalldataABIs: Record<string, string>;
}

describe("external JSON contract doc conformance", () => {
  test("contract schema version follows the checked-in intent gate", () => {
    const versionedDoc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const currentDoc = JSON.parse(readFileSync(CURRENT_CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const intent = JSON.parse(readFileSync(SCHEMA_VERSION_INTENT_PATH, "utf8")) as {
      schemaVersion?: string;
    };

    expect(intent.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(versionedDoc.schemaVersion).toBe(intent.schemaVersion);
    expect(currentDoc.schemaVersion).toBe(intent.schemaVersion);
  });

  test("agent skill contract heading matches the active JSON schema version", () => {
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools/SKILL.md`, "utf8");
    expect(skill).toContain(`## 2. JSON output contract (v${JSON_SCHEMA_VERSION})`);
  });

  test("doc version is explicit and aligned with runtime schema version", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    expect(doc.version).toBe(JSON_SCHEMA_VERSION);
    expect(doc.schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });

  test("stable current contract path matches the runtime versioned snapshot", () => {
    const versionedDoc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const currentDoc = JSON.parse(readFileSync(CURRENT_CONTRACT_DOC_PATH, "utf8")) as ContractDoc;

    expect(currentDoc).toEqual(versionedDoc);
    expect(currentDoc.version).toBe(JSON_SCHEMA_VERSION);
    expect(currentDoc.schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });

  test("generated contract section matches the Zod-derived generator output", async () => {
    const currentDoc = JSON.parse(readFileSync(CURRENT_CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const generator = await import("../../scripts/generate-json-contract.mjs");
    const generated = generator.generateJsonContractSection() as unknown;

    expect(currentDoc.generated).toEqual(generated);
  });

  test("doc includes the full exit code map used by runtime", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    expect(doc.exitCodes).toEqual({
      "0": "SUCCESS",
      [String(EXIT_CODES.UNKNOWN)]: "UNKNOWN_ERROR",
      [String(EXIT_CODES.INPUT)]: "INPUT_ERROR",
      [String(EXIT_CODES.RPC)]: "RPC_ERROR",
      [String(EXIT_CODES.SETUP)]: "SETUP_REQUIRED",
      [String(EXIT_CODES.ASP)]: "ASP_ERROR",
      [String(EXIT_CODES.RELAYER)]: "RELAYER_ERROR",
      [String(EXIT_CODES.PROOF)]: "PROOF_ERROR",
      [String(EXIT_CODES.CONTRACT)]: "CONTRACT_ERROR",
      [String(EXIT_CODES.CANCELLED)]: "PROMPT_CANCELLED",
    });
  });

  test("doc includes unsigned output variants and ABI signatures", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;

    expect("deposit" in doc.commands).toBe(true);
    expect("withdraw" in doc.commands).toBe(true);
    expect("ragequit" in doc.commands).toBe(true);

    expect(doc.unsignedCalldataABIs).toEqual({
      depositNative: "function deposit(uint256 _precommitment) payable",
      depositErc20: "function deposit(address _asset, uint256 _value, uint256 _precommitment)",
      approveErc20: "function approve(address spender, uint256 amount)",
      withdrawDirect: "function withdraw((address processooor, bytes data) _withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) _proof)",
      withdrawRelayed: "function relay((address processooor, bytes data) _withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) _proof, uint256 _scope)",
      ragequit: "function ragequit((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals) _proof)",
    });
    expect(doc.shared?.rawUnsignedTransaction).toEqual({
      to: "0x-prefixed-address",
      data: "0x-prefixed-hex-calldata",
      value: "decimal-string-wei",
      valueHex: "0x-prefixed-hex-quantity-wei",
      chainId: "number",
      description: "string",
    });
  });

  test("generated command contract covers the active command corpus", () => {
    const doc = JSON.parse(readFileSync(CONTRACT_DOC_PATH, "utf8")) as ContractDoc;
    const generated = doc.generated as {
      commands?: Record<string, {
        successFields?: Record<string, string>;
        variants?: string[];
      }>;
    } | undefined;

    expect(Object.keys(generated?.commands ?? {}).sort()).toEqual(
      [...COMMAND_PATHS].sort(),
    );
    for (const [command, contract] of Object.entries(generated?.commands ?? {})) {
      expect(
        Object.keys(contract.successFields ?? {}).length,
        `${command} should have generated success fields`,
      ).toBeGreaterThan(0);
      expect(contract.variants).toEqual(["success", "error"]);
    }
  });
});
