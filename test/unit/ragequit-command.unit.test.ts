import { describe, expect, test } from "bun:test";
import type { AccountCommitment, PrivacyPoolAccount } from "@0xbow/privacy-pools-core-sdk";
import type { PoolAccountRef } from "../../src/utils/pool-accounts.ts";
import {
  buildRagequitPoolAccountRefs,
  formatRagequitPoolAccountChoice,
  getRagequitAdvisory,
} from "../../src/commands/ragequit.ts";
import { POA_PORTAL_URL } from "../../src/config/chains.ts";

function makePoolAccountRef(
  overrides: Partial<PoolAccountRef> = {},
): PoolAccountRef {
  return {
    paNumber: 1,
    paId: "PA-1",
    status: "approved",
    aspStatus: "approved",
    commitment: {
      hash: 111n,
      nullifier: 222n,
      nullifierHash: 333n,
      secret: 444n,
      value: 1000000000000000000n,
      label: 555n,
      blockNumber: 123n,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    label: 555n,
    value: 1000000000000000000n,
    blockNumber: 123n,
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...overrides,
  };
}

function commitment(
  label: bigint,
  hash: bigint,
  value: bigint,
): AccountCommitment {
  return {
    label,
    hash,
    value,
    blockNumber: 123n,
    txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nullifier: 777n as any,
    secret: 888n as any,
  };
}

describe("ragequit command helpers", () => {
  test("formats pool account choices with amount and status", () => {
    const label = formatRagequitPoolAccountChoice(
      makePoolAccountRef({ status: "declined", aspStatus: "declined" }),
      18,
      "ETH",
    );

    expect(label).toContain("PA-1");
    expect(label).toContain("1 ETH");
    expect(label).toContain("Declined");
  });

  test("approved advisory warns that a private path still exists", () => {
    const advisory = getRagequitAdvisory(makePoolAccountRef());

    expect(advisory).not.toBeNull();
    expect(advisory?.level).toBe("warn");
    expect(advisory?.message).toContain("approved for private withdrawal");
  });

  test("pending advisory explains ragequit is an alternative to waiting", () => {
    const advisory = getRagequitAdvisory(
      makePoolAccountRef({ status: "pending", aspStatus: "pending" }),
    );

    expect(advisory).not.toBeNull();
    expect(advisory?.level).toBe("info");
    expect(advisory?.message).toContain("prefer public recovery instead of waiting");
  });

  test("poi_required advisory points to the PoA flow", () => {
    const advisory = getRagequitAdvisory(
      makePoolAccountRef({ status: "poi_required", aspStatus: "poi_required" }),
    );

    expect(advisory).not.toBeNull();
    expect(advisory?.message).toContain(POA_PORTAL_URL);
    expect(advisory?.message).toContain("private withdrawal");
  });

  test("declined advisory marks ragequit as the only recovery path", () => {
    const advisory = getRagequitAdvisory(
      makePoolAccountRef({ status: "declined", aspStatus: "declined" }),
    );

    expect(advisory).not.toBeNull();
    expect(advisory?.message).toContain("only recovery path");
  });

  test("unknown advisory stays silent", () => {
    expect(
      getRagequitAdvisory(
        makePoolAccountRef({ status: "unknown", aspStatus: "unknown" }),
      ),
    ).toBeNull();
  });

  test("hydrates ragequit Pool Account statuses from ASP review data", () => {
    const scope = 444n;
    const approved = commitment(10n, 101n, 100n);
    const declined = commitment(20n, 202n, 200n);
    const poiRequired = commitment(30n, 303n, 300n);
    const approvedButLeafPending = commitment(40n, 404n, 400n);

    const account: PrivacyPoolAccount = {
      masterKeys: [1n as any, 2n as any],
      poolAccounts: new Map([
        [scope as any, [
          { label: approved.label as any, deposit: approved, children: [] },
          { label: declined.label as any, deposit: declined, children: [] },
          { label: poiRequired.label as any, deposit: poiRequired, children: [] },
          { label: approvedButLeafPending.label as any, deposit: approvedButLeafPending, children: [] },
        ]],
      ]) as any,
    };

    const refs = buildRagequitPoolAccountRefs(
      account,
      scope,
      [approved, declined, poiRequired, approvedButLeafPending],
      new Set([approved.label.toString()]),
      new Map([
        [approved.label.toString(), "approved"],
        [declined.label.toString(), "declined"],
        [poiRequired.label.toString(), "poi_required"],
        [approvedButLeafPending.label.toString(), "approved"],
      ]),
    );

    expect(refs.map((row) => row.status)).toEqual([
      "approved",
      "declined",
      "poi_required",
      "pending",
    ]);
  });
});
