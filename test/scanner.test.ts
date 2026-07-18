import { describe, expect, it } from "vitest";
import { rules } from "../src/scanner/rules.js";
import { scanDiff } from "../src/scanner/scanDiff.js";
import type { DiffHunk, Finding } from "../src/scanner/types.js";
import { explainResponseSchema, patchResponseSchema } from "../src/ai/schemas.js";

const sampleHunk: DiffHunk = {
  file: "src/server.ts",
  language: "typescript",
  addedLines: [{ line: 12, content: 'const OPENAI_API_KEY = "sk-demo-leaked-key";' }],
  context: "",
};

describe("scanner stubs", () => {
  it("every stub rule returns null against a sample hunk", () => {
    for (const rule of rules) {
      expect(rule(sampleHunk)).toBeNull();
    }
  });

  it("scanDiff runs all rules against all hunks and collects findings", () => {
    const findings: Finding[] = scanDiff([sampleHunk]);
    expect(findings).toEqual([]);
  });

  it("Finding shape matches the shared contract", () => {
    const finding: Finding = {
      id: "test-1",
      severity: "critical",
      category: "secret",
      title: "Hardcoded API key",
      file: "src/server.ts",
      line: 12,
      evidence: 'const OPENAI_API_KEY = "sk-demo-leaked-key";',
      explanation: "This key could be exposed in the remote repository.",
      recommendation: "Move the secret to process.env.OPENAI_API_KEY.",
      source: "rule",
    };
    expect(finding.severity).toBe("critical");
  });
});

describe("Backboard response schemas", () => {
  it("parses a valid explain response", () => {
    const result = explainResponseSchema.parse({
      risk: "high",
      is_exploitable: true,
      summary: "Hardcoded key found",
      recommendation: "Move to env var",
    });
    expect(result.risk).toBe("high");
  });

  it("rejects an invalid explain response", () => {
    expect(explainResponseSchema.safeParse({ risk: "nope" }).success).toBe(false);
  });

  it("parses a valid patch response", () => {
    const result = patchResponseSchema.parse({
      patch: "const x = process.env.X;",
      explanation: "Use env var instead of literal",
    });
    expect(result.patch).toContain("process.env");
  });

  it("rejects an invalid patch response", () => {
    expect(patchResponseSchema.safeParse({ patch: 123 }).success).toBe(false);
  });
});
