import { describe, expect, it } from "vitest";
import type { AiScanContext } from "../../src/context/buildScanContext.js";
import type { AiScanFinding } from "../../src/ai/schemas.js";
import { mergeFindings } from "../../src/scanner/mergeFindings.js";
import type { Finding } from "../../src/scanner/types.js";

const context: AiScanContext = {
  version: 1,
  files: [
    {
      path: "src/server.ts",
      language: "typescript",
      addedLines: [{ line: 12, content: 'const API_KEY = "[REDACTED]";' }],
      nearbyContext: "",
    },
  ],
  limits: { maxFindings: 5, timeoutMs: 10_000 },
  omittedFileCount: 0,
};

function aiFinding(overrides: Partial<AiScanFinding> = {}): AiScanFinding {
  return {
    severity: "critical",
    category: "secret",
    title: "Hardcoded API key",
    file: "src/server.ts",
    line: 12,
    evidence: 'const API_KEY = "[REDACTED]";',
    explanation: "The credential would be available in repository history.",
    recommendation: "Load the credential from the environment and rotate it.",
    confidence: 0.95,
    exploitability: "high",
    trustBoundary: "source control",
    ...overrides,
  };
}

function ruleFinding(): Finding {
  return {
    id: "hardcoded-api-key",
    severity: "critical",
    category: "secret",
    title: "Hardcoded API key detected",
    file: "src/server.ts",
    line: 12,
    evidence: 'const API_KEY = "[REDACTED]";',
    explanation: "Rule explanation.",
    recommendation: "Rule recommendation.",
    source: "rule",
  };
}

describe("mergeFindings", () => {
  it("merges overlapping rule and AI findings without lowering severity", () => {
    const merged = mergeFindings([ruleFinding()], [aiFinding({ severity: "high" })], context, 0.85);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: "hybrid", severity: "critical", confidence: 0.95 });
  });

  it("keeps low-confidence AI-only findings as warnings", () => {
    const merged = mergeFindings([], [aiFinding({ confidence: 0.4 })], context, 0.85);

    expect(merged[0]).toMatchObject({ source: "ai", severity: "medium", confidence: 0.4 });
  });

  it("rejects AI findings that name an unknown file or unchanged line", () => {
    expect(mergeFindings([], [aiFinding({ file: "src/invented.ts" })], context, 0.85)).toEqual([]);
    expect(mergeFindings([], [aiFinding({ line: 99 })], context, 0.85)).toEqual([]);
  });
});
