/**
 * Semantic ABI selector parity conformance.
 *
 * Computes 4-byte function selectors from the CLI's ABI definitions and
 * from the upstream Solidity interface files, then asserts they match.
 * This catches parameter reordering, type changes, and tuple shape changes
 * that string-level toContain() checks would miss.
 *
 * The upstream Solidity uses named structs (e.g. IPrivacyPool.Withdrawal,
 * ProofLib.WithdrawProof).  We resolve those to inline tuples before
 * computing selectors, since the canonical ABI selector is computed from
 * the tuple-expanded form.
 *
 * Uses viem's toFunctionSelector (already a project dependency) so no
 * additional AST parser is needed.
 *
 * @online
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { toFunctionSelector } from "viem";
import { CORE_REPO, fetchGitHubFile } from "../helpers/github.ts";

// ── CLI ABIs (imported from source of truth) ────────────────────────────────

import {
  erc20ApproveAbi,
  entrypointDepositNativeAbi,
  entrypointDepositErc20Abi,
  privacyPoolWithdrawAbi,
  entrypointRelayAbi,
  privacyPoolRagequitAbi,
} from "../../src/utils/unsigned-flows.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Computes the 4-byte selector from a viem-parsed ABI for its first
 * function entry.
 */
function selectorFromParsedAbi(abi: readonly any[]): string {
  const fn = abi.find((item: any) => item.type === "function");
  if (!fn) throw new Error("No function found in ABI");
  return toFunctionSelector(fn);
}

/**
 * Extracts struct definitions from Solidity source code.
 * Returns a map of struct name → tuple type string.
 *
 * Example: `struct Withdrawal { address processooor; bytes data; }`
 *       → Map { "Withdrawal" => "(address,bytes)" }
 */
function extractStructs(source: string): Map<string, string> {
  const structs = new Map<string, string>();
  const collapsed = source.replace(/\n/g, " ").replace(/\s+/g, " ");

  const re = /struct\s+(\w+)\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(collapsed)) !== null) {
    const name = m[1];
    const body = m[2].trim();
    const fields = body
      .split(";")
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .map((f) => f.split(/\s+/)[0]);
    structs.set(name, `(${fields.join(",")})`);
  }
  return structs;
}

/**
 * Given a single param like "(address,bytes) _w" or "uint256 _scope" or
 * "uint256[8] pubSignals", return just the type: "(address,bytes)" or
 * "uint256" or "uint256[8]".
 */
function extractType(param: string): string {
  // If param starts with a tuple, the type is everything up to and including
  // the matching close-paren (possibly with array suffixes)
  if (param.startsWith("(")) {
    let depth = 0;
    let i = 0;
    for (; i < param.length; i++) {
      if (param[i] === "(") depth++;
      if (param[i] === ")") depth--;
      if (depth === 0) break;
    }
    // Include any array suffixes after the closing paren
    const rest = param.substring(i + 1);
    const arraySuffix = rest.match(/^(\[\d*\])*/)?.[0] || "";
    return param.substring(0, i + 1) + arraySuffix;
  }

  // Otherwise: "type name" or just "type" — take first whitespace-delimited token
  const trimmed = param.replace(/\s+/g, " ").trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return trimmed;
  return trimmed.substring(0, spaceIdx);
}

/**
 * Resolves a Solidity function signature by replacing struct references
 * with their tuple expansions, resolving interface types to `address`,
 * stripping Solidity-specific keywords, and removing parameter names.
 *
 * This processes the function name and params separately to avoid the
 * param-name-stripping regex eating the function name.
 *
 * Input:  "function withdraw(IPrivacyPool.Withdrawal calldata _w, ProofLib.WithdrawProof memory _p) external;"
 * Output: "function withdraw((address,bytes),(uint256[2],uint256[2][2],uint256[2],uint256[8]))"
 */
function resolveSignature(
  sig: string,
  structs: Map<string, string>,
): string {
  // 1. Extract function name and params separately
  const funcMatch = sig.match(/function\s+(\w+)\s*\((.*)$/s);
  if (!funcMatch) throw new Error(`Cannot parse function signature: ${sig}`);
  const funcName = funcMatch[1];
  let params = funcMatch[2];

  // Strip everything after the matching close-paren (modifiers, semicolons, etc.)
  let depth = 1;
  let i = 0;
  for (; i < params.length && depth > 0; i++) {
    if (params[i] === "(") depth++;
    if (params[i] === ")") depth--;
  }
  params = params.substring(0, i - 1);

  // 2. Replace struct references with tuple expansions
  for (const [name, tuple] of structs) {
    params = params.replace(
      new RegExp(`\\w+\\.${name}|\\b${name}\\b`, "g"),
      tuple,
    );
  }

  // 3. Replace interface types (IERC20, IPrivacyPool, etc.) with address
  params = params.replace(/\bI[A-Z]\w+\b/g, "address");

  // 4. Strip Solidity keywords
  params = params.replace(
    /\b(calldata|memory|storage|indexed)\b/g,
    "",
  );

  // 5. Strip parameter names — split by commas at depth 0, then keep only types
  const resolved: string[] = [];
  let current = "";
  depth = 0;
  for (const ch of params) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      resolved.push(extractType(current.trim()));
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    resolved.push(extractType(current.trim()));
  }

  return `function ${funcName}(${resolved.join(",")})`;
}

/**
 * Extracts all function signatures from a Solidity interface file.
 * Handles nested parentheses (struct params contain parens).
 */
function extractRawFunctions(source: string): string[] {
  const collapsed = source.replace(/\n/g, " ").replace(/\s+/g, " ");
  const results: string[] = [];

  // Find each "function <name>(" then track paren depth to find the end
  const re = /function\s+\w+\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(collapsed)) !== null) {
    const start = m.index;
    // Count from the opening paren we just matched
    let depth = 1;
    let pos = m.index + m[0].length;
    while (pos < collapsed.length && depth > 0) {
      if (collapsed[pos] === "(") depth++;
      if (collapsed[pos] === ")") depth--;
      pos++;
    }
    // pos now points just past the closing paren; grab through the next semicolon
    const semi = collapsed.indexOf(";", pos);
    if (semi !== -1) {
      results.push(collapsed.substring(start, semi + 1));
    }
  }
  return results;
}

/**
 * Finds a function by name from an array of raw signatures.
 * For overloaded functions, pass a filter predicate to distinguish.
 */
function findFunction(
  sigs: string[],
  name: string,
  filter?: (sig: string) => boolean,
): string | undefined {
  return sigs.find((s) => {
    const fnMatch = s.match(/function\s+(\w+)/);
    if (!fnMatch || fnMatch[1] !== name) return false;
    if (filter && !filter(s)) return false;
    return true;
  });
}

// ── Upstream sources ────────────────────────────────────────────────────────

let upstreamIPrivacyPool = "";
let upstreamIEntrypoint = "";
let upstreamProofLib = "";
let fetchFailed = false;

describe("ABI selector parity conformance", () => {
  beforeAll(async () => {
    try {
      [upstreamIPrivacyPool, upstreamIEntrypoint, upstreamProofLib] =
        await Promise.all([
          fetchGitHubFile(
            CORE_REPO,
            "packages/contracts/src/interfaces/IPrivacyPool.sol",
          ),
          fetchGitHubFile(
            CORE_REPO,
            "packages/contracts/src/interfaces/IEntrypoint.sol",
          ),
          fetchGitHubFile(
            CORE_REPO,
            "packages/contracts/src/contracts/lib/ProofLib.sol",
          ),
        ]);
    } catch (err) {
      console.warn(
        "Skipping ABI selector parity — could not read source-of-truth files:",
        err,
      );
      fetchFailed = true;
    }
  });

  test("source-of-truth reads succeeded (canary)", () => {
    if (fetchFailed) {
      console.warn(
        "WARN: source-of-truth reads failed — ABI selector parity tests are NOT running",
      );
    }
    expect(fetchFailed).toBe(false);
  });

  const run = (name: string, fn: () => void) => {
    test(name, () => {
      if (fetchFailed) return;
      fn();
    });
  };

  // ── withdraw ────────────────────────────────────────────────────────────

  run("withdraw() 4-byte selector matches upstream IPrivacyPool.sol", () => {
    const cliSelector = selectorFromParsedAbi(privacyPoolWithdrawAbi);

    const structs = new Map([
      ...extractStructs(upstreamIPrivacyPool),
      ...extractStructs(upstreamProofLib),
    ]);

    const rawSigs = extractRawFunctions(upstreamIPrivacyPool);
    const rawWithdraw = findFunction(rawSigs, "withdraw");
    const resolved = resolveSignature(rawWithdraw!, structs);
    const upstreamSelector = toFunctionSelector(resolved);

    expect(cliSelector).toBe(upstreamSelector);
  });

  // ── relay ───────────────────────────────────────────────────────────────

  run("relay() 4-byte selector matches upstream IEntrypoint.sol", () => {
    const cliSelector = selectorFromParsedAbi(entrypointRelayAbi);

    const structs = new Map([
      ...extractStructs(upstreamIPrivacyPool),
      ...extractStructs(upstreamProofLib),
    ]);

    const rawSigs = extractRawFunctions(upstreamIEntrypoint);
    const rawRelay = findFunction(rawSigs, "relay");
    const resolved = resolveSignature(rawRelay!, structs);
    const upstreamSelector = toFunctionSelector(resolved);

    expect(cliSelector).toBe(upstreamSelector);
  });

  // ── deposit (native — single uint256 overload) ─────────────────────────

  run("deposit(uint256) 4-byte selector matches upstream IEntrypoint.sol", () => {
    const cliSelector = selectorFromParsedAbi(entrypointDepositNativeAbi);

    const rawSigs = extractRawFunctions(upstreamIEntrypoint);
    // Native overload: no IERC20/address param, just uint256
    const nativeOnly = rawSigs.filter(
      (s) =>
        s.match(/function\s+deposit/) &&
        !s.includes("IERC20") &&
        !s.includes("address") &&
        s.includes("uint256"),
    );
    expect(nativeOnly.length).toBeGreaterThanOrEqual(1);

    const resolved = resolveSignature(nativeOnly[0], new Map());
    const upstreamSelector = toFunctionSelector(resolved);

    expect(cliSelector).toBe(upstreamSelector);
  });

  // ── deposit (ERC-20 — address, uint256, uint256 overload) ──────────────

  run("deposit(address,uint256,uint256) 4-byte selector matches upstream IEntrypoint.sol", () => {
    const cliSelector = selectorFromParsedAbi(entrypointDepositErc20Abi);

    const rawSigs = extractRawFunctions(upstreamIEntrypoint);
    // ERC-20 overload: uses IERC20 param (resolved to address)
    const erc20Only = rawSigs.filter(
      (s) => s.match(/function\s+deposit/) && s.includes("IERC20"),
    );
    expect(erc20Only.length).toBeGreaterThanOrEqual(1);

    const resolved = resolveSignature(erc20Only[0], new Map());
    const upstreamSelector = toFunctionSelector(resolved);

    expect(cliSelector).toBe(upstreamSelector);
  });

  // ── ragequit ────────────────────────────────────────────────────────────

  run("ragequit() 4-byte selector matches upstream IPrivacyPool.sol", () => {
    const cliSelector = selectorFromParsedAbi(privacyPoolRagequitAbi);

    const structs = new Map([
      ...extractStructs(upstreamIPrivacyPool),
      ...extractStructs(upstreamProofLib),
    ]);

    const rawSigs = extractRawFunctions(upstreamIPrivacyPool);
    const rawRagequit = findFunction(rawSigs, "ragequit");
    const resolved = resolveSignature(rawRagequit!, structs);
    const upstreamSelector = toFunctionSelector(resolved);

    expect(cliSelector).toBe(upstreamSelector);
  });

  // ── approve (ERC-20 standard — not upstream-dependent) ─────────────────

  run("approve() selector is the canonical ERC-20 selector", () => {
    const cliSelector = selectorFromParsedAbi(erc20ApproveAbi);
    // ERC-20 approve(address,uint256) canonical selector: 0x095ea7b3
    expect(cliSelector).toBe("0x095ea7b3");
  });
});
