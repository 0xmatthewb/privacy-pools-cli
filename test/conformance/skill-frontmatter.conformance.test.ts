import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { load as loadYaml } from "js-yaml";
import semver from "semver";

const CLI_ROOT = join(import.meta.dir, "..", "..");

interface SkillConfig {
  path: string;
  canonicalBin: string;
  canonicalNpmPackage: string;
  requiresReferenceDoc: boolean;
}

const SKILLS: readonly SkillConfig[] = [
  {
    path: "skills/privacy-pools",
    canonicalBin: "privacy-pools",
    canonicalNpmPackage: "privacy-pools-cli",
    requiresReferenceDoc: true,
  },
];

const BANNED_TOP_LEVEL_KEYS = ["permissions", "triggers", "author", "version"] as const;
const FRAGILE_CHARS_REGEX = /[—–‘’“”]/u;

function parseSkillFrontmatter(skillDir: string) {
  const skillMd = join(CLI_ROOT, skillDir, "SKILL.md");
  const raw = readFileSync(skillMd, "utf8");
  const match = raw.match(/^---\n([\s\S]+?)\n---/);
  if (!match) throw new Error(`No frontmatter found in ${skillMd}`);
  const data = loadYaml(match[1]!) as Record<string, unknown>;
  return { raw, frontmatterText: match[1]!, data, skillMd };
}

describe("SKILL.md frontmatter conformance", () => {
  for (const skill of SKILLS) {
    describe(skill.path, () => {
      const { data, frontmatterText } = parseSkillFrontmatter(skill.path);

      test("required fields present and non-empty", () => {
        expect(typeof data.name).toBe("string");
        expect((data.name as string).length).toBeGreaterThan(0);
        expect(typeof data.description).toBe("string");
        expect((data.description as string).length).toBeGreaterThan(0);
      });

      test("name matches parent directory name", () => {
        expect(data.name).toBe(basename(skill.path));
      });

      test("name conforms to open-spec character set and length", () => {
        const name = data.name as string;
        expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).not.toMatch(/anthropic|claude/i);
      });

      test("description <=1024 chars", () => {
        expect((data.description as string).length).toBeLessThanOrEqual(1024);
      });

      test("compatibility <=500 chars (when present)", () => {
        if (data.compatibility !== undefined) {
          expect(typeof data.compatibility).toBe("string");
          expect((data.compatibility as string).length).toBeLessThanOrEqual(500);
        }
      });

      test("license matches package.json license", () => {
        const pkg = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8"));
        expect(data.license).toBe(pkg.license);
      });

      test("metadata.version is valid semver", () => {
        const meta = data.metadata as Record<string, unknown>;
        expect(typeof meta?.version).toBe("string");
        expect(semver.valid(meta.version as string)).not.toBeNull();
      });

      test("no banned top-level fields", () => {
        for (const banned of BANNED_TOP_LEVEL_KEYS) {
          expect(data).not.toHaveProperty(banned);
        }
      });

      test("metadata is a parsed object (JSON-in-YAML), not multi-line YAML keys", () => {
        expect(frontmatterText).toMatch(/^metadata:\n\s+\{/m);
        expect(typeof data.metadata).toBe("object");
        expect(data.metadata).not.toBeNull();
        expect(Array.isArray(data.metadata)).toBe(false);
      });

      test("metadata.openclaw.requires.bins includes canonical bin", () => {
        const meta = data.metadata as Record<string, any>;
        expect(meta.openclaw?.requires?.bins).toContain(skill.canonicalBin);
      });

      test("metadata.clawdbot.requires.bins includes canonical bin", () => {
        const meta = data.metadata as Record<string, any>;
        expect(meta.clawdbot?.requires?.bins).toContain(skill.canonicalBin);
      });

      test("metadata.openclaw.install[] contains node-kind installer for canonical npm package", () => {
        const meta = data.metadata as Record<string, any>;
        const installs = meta.openclaw?.install as Array<Record<string, unknown>> | undefined;
        expect(Array.isArray(installs)).toBe(true);
        const nodeInstall = installs?.find((install) => install.kind === "node");
        expect(nodeInstall).toBeDefined();
        expect(nodeInstall?.package).toBe(skill.canonicalNpmPackage);
        expect(nodeInstall?.bins).toEqual([skill.canonicalBin]);
        expect(typeof nodeInstall?.id).toBe("string");
        expect(typeof nodeInstall?.label).toBe("string");
      });

      test("frontmatter strings contain no UTF-8-fragile characters", () => {
        expect(frontmatterText).not.toMatch(FRAGILE_CHARS_REGEX);
      });

      test("references/reference.md exists when required", () => {
        if (skill.requiresReferenceDoc) {
          const refPath = join(CLI_ROOT, skill.path, "references", "reference.md");
          expect(existsSync(refPath)).toBe(true);
        }
      });

      test("metadata.author is a structured object with name", () => {
        const meta = data.metadata as Record<string, any>;
        expect(typeof meta.author).toBe("object");
        expect(typeof meta.author?.name).toBe("string");
      });
    });
  }
});
