import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  PREVIEW_COVERAGE_SPEC,
  FLOW_STATUS_PREVIEW_PHASES,
  PREVIEW_CASES,
  PREVIEW_EXECUTION_KINDS,
  PREVIEW_FIDELITIES,
  PREVIEW_MODES,
  PREVIEW_OWNERS,
  PREVIEW_PROGRESS_INVENTORY,
  PREVIEW_PROMPT_INVENTORY,
  PREVIEW_RUNTIMES,
  PREVIEW_SOURCES,
  PREVIEW_STATE_CLASSES,
  PREVIEW_TRUTH_REQUIREMENTS,
  PREVIEW_VARIANT_IDS,
  findPreviewCase,
} from "../../scripts/lib/preview-cli-catalog.mjs";
import { GENERATED_COMMAND_PATHS } from "../../src/utils/command-manifest.ts";

const previewCaseSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    journey: z.string().min(1),
    surface: z.string().min(1),
    owner: z.string().refine((value) => PREVIEW_OWNERS.includes(value)),
    runtime: z.string().refine((value) => PREVIEW_RUNTIMES.includes(value)),
    source: z.string().refine((value) => PREVIEW_SOURCES.includes(value)),
    executionKind: z.string().refine((value) =>
      PREVIEW_EXECUTION_KINDS.includes(value),
    ),
    modes: z
      .array(z.string().refine((value) => PREVIEW_MODES.includes(value)))
      .nonempty()
      .refine((value) => new Set(value).size === value.length),
    covers: z.array(z.string()).nonempty(),
    requiredSetup: z.array(z.string()).nonempty(),
    expectedExitCodes: z.array(z.number().int()).nonempty(),
    commandPath: z.string().min(1),
    stateId: z.string().min(1),
    stateClass: z.string().refine((value) =>
      PREVIEW_STATE_CLASSES.includes(value),
    ),
    truthRequirement: z.string().refine((value) =>
      PREVIEW_TRUTH_REQUIREMENTS.includes(value),
    ),
    fidelity: z.string().refine((value) => PREVIEW_FIDELITIES.includes(value)),
    interactive: z.boolean(),
    runtimeTarget: z.string(),
    variantPolicy: z
      .array(z.string().refine((value) => PREVIEW_VARIANT_IDS.includes(value)))
      .nonempty(),
    syntheticReason: z.string().min(1).optional(),
    preview: z
      .object({
        requiresTtyScript: z.boolean().optional(),
        ttyScript: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .superRefine((previewCase, ctx) => {
    const requiresSyntheticReason =
      previewCase.executionKind === "renderer-fixture"
      || previewCase.requiredSetup.includes("preview-scenario")
      || previewCase.fidelity === "progress-snapshot";

    if (requiresSyntheticReason && !previewCase.syntheticReason) {
      ctx.addIssue({
        code: "custom",
        message: "syntheticReason is required for synthetic preview cases",
        path: ["syntheticReason"],
      });
    }

    if (!requiresSyntheticReason && previewCase.syntheticReason !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "syntheticReason must stay absent for live preview cases",
        path: ["syntheticReason"],
      });
    }
  });

describe("preview cli catalog", () => {
  test("declares the richer preview contract for every case", () => {
    const ids = PREVIEW_CASES.map((previewCase) =>
      previewCaseSchema.parse(previewCase).id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("keeps key user journeys and ownership sentinels covered", () => {
    for (const caseId of [
      "welcome-banner",
      "root-help",
      "init-configured-wallet",
      "init-setup-mode-prompt",
      "status-ready",
      "accounts-empty",
      "accounts-populated",
      "deposit-success",
      "withdraw-success-relayed",
      "withdraw-success-direct",
      "ragequit-success",
      "flow-start-configured",
      "flow-watch-ready",
      "flow-watch-completed",
      "flow-ragequit-success",
      "upgrade-performed",
      "native-pool-detail",
      "forwarded-pool-detail",
    ]) {
      expect(findPreviewCase(caseId)).not.toBeNull();
    }

    for (const commandPath of ["root", ...GENERATED_COMMAND_PATHS]) {
      expect(
        PREVIEW_CASES.some((previewCase) => previewCase.commandPath === commandPath),
      ).toBe(true);
    }

    expect(findPreviewCase("forwarded-pool-detail")).toMatchObject({
      owner: "forwarded",
      runtime: "forwarded",
      surface: "pools",
      source: "live-command",
      executionKind: "live-command",
    });

    expect(findPreviewCase("accounts-empty")).toMatchObject({
      owner: "forwarded",
      runtime: "forwarded",
      surface: "accounts",
      source: "live-command",
      executionKind: "live-command",
      syntheticReason: expect.any(String),
    });
  });

  test("includes help coverage for every generated command path", () => {
    const helpCaseIds = PREVIEW_CASES
      .filter((previewCase) => previewCase.surface === "help")
      .map((previewCase) => previewCase.id)
      .sort();
    const expectedHelpCaseIds = GENERATED_COMMAND_PATHS
      .map((commandPath) => `help-${commandPath.replace(/\s+/g, "-")}`)
      .sort();

    expect(helpCaseIds).toEqual([
      ...expectedHelpCaseIds,
      "root-help",
    ].sort());

    for (const caseId of expectedHelpCaseIds) {
      expect(findPreviewCase(caseId)).toMatchObject({
        owner: "native",
        runtime: "native",
        source: "live-command",
        executionKind: "live-command",
        surface: "help",
      });
    }
  });

  test("includes flow status coverage for every supported phase", () => {
    const flowCases = PREVIEW_CASES
      .filter((previewCase) => previewCase.id.startsWith("flow-status-"))
      .map((previewCase) => previewCase.id.slice("flow-status-".length))
      .sort();

    expect(flowCases).toEqual([...FLOW_STATUS_PREVIEW_PHASES].sort());
  });

  test("marks interactive prompt cases as tty-only", () => {
    for (const prompt of PREVIEW_PROMPT_INVENTORY) {
      expect(findPreviewCase(prompt.caseId)).toMatchObject({
        modes: ["tty"],
        stateClass: "prompt",
      });
    }
  });

  test("allows expected non-zero exits for validation and error states", () => {
    expect(findPreviewCase("deposit-validation")).toMatchObject({
      expectedExitCodes: [2],
    });
    expect(findPreviewCase("withdraw-validation")).toMatchObject({
      expectedExitCodes: [2],
    });
    expect(findPreviewCase("ragequit-validation")).toMatchObject({
      expectedExitCodes: [2],
    });
    expect(findPreviewCase("flow-start-validation")).toMatchObject({
      expectedExitCodes: [2],
    });
    expect(findPreviewCase("flow-ragequit-error")).toMatchObject({
      expectedExitCodes: [2],
    });
  });

  test("requires tty scripts for prompt cases that must drive earlier input", () => {
    for (const prompt of PREVIEW_PROMPT_INVENTORY) {
      const previewCase = findPreviewCase(prompt.caseId);
      expect(previewCase?.preview?.requiresTtyScript).toBe(true);
      expect(previewCase?.preview?.ttyScript).toEqual(expect.anything());
    }
  });

  test("declares prompt and progress coverage inventories explicitly", () => {
    expect(new Set(PREVIEW_COVERAGE_SPEC.commandInventory).size).toBe(
      PREVIEW_COVERAGE_SPEC.commandInventory.length,
    );
    expect(PREVIEW_COVERAGE_SPEC.commandInventory).toContain("root");

    for (const commandPath of PREVIEW_COVERAGE_SPEC.commandInventory) {
      expect(commandPath === "root" || GENERATED_COMMAND_PATHS.includes(commandPath)).toBe(
        true,
      );
    }

    for (const prompt of PREVIEW_PROMPT_INVENTORY) {
      expect(findPreviewCase(prompt.caseId)).toMatchObject({
        commandPath: prompt.commandPath,
        stateClass: "prompt",
        modes: ["tty"],
      });
    }

    for (const progress of PREVIEW_PROGRESS_INVENTORY) {
      const previewCase = findPreviewCase(progress.caseId);
      expect(previewCase).toMatchObject({
        stateClass: "progress-step",
        fidelity: "progress-snapshot",
      });
      expect(
        previewCase?.commandPath === progress.commandPath
          || previewCase?.commandPath.startsWith(`${progress.commandPath} `),
      ).toBe(true);
    }
  });

  test("tracks native-route audit obligations for hybrid and native commands", () => {
    expect(
      PREVIEW_COVERAGE_SPEC.nativeRouteInventory.some(
        (entry) => entry.commandPath === "pools",
      ),
    ).toBe(true);
    expect(findPreviewCase("native-pools-list")).not.toBeNull();
    expect(findPreviewCase("native-pools-no-match")).not.toBeNull();
    expect(findPreviewCase("native-pool-detail")).not.toBeNull();
  });
});
