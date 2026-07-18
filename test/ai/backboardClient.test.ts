import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explainFinding } from "../../src/ai/backboardClient.js";
import type { DiffHunk, Finding } from "../../src/scanner/types.js";

const finding: Finding = {
  id: "hardcoded-api-key",
  severity: "critical",
  category: "secret",
  title: "Hardcoded API key detected",
  file: "src/server.ts",
  line: 12,
  evidence: 'const KEY = "sk-x";',
  explanation: "",
  recommendation: "",
  source: "rule",
};

const hunk: DiffHunk = {
  file: "src/server.ts",
  language: "typescript",
  addedLines: [{ line: 12, content: 'const KEY = "sk-x";' }],
  context: "",
};

function mockFetchJson(payload: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? "OK" : "Error",
      json: async () => payload,
    })) as unknown as typeof fetch,
  );
}

describe("explainFinding (Backboard client)", () => {
  beforeEach(() => {
    process.env.BACKBOARD_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BACKBOARD_API_KEY;
  });

  it("extracts a valid explain payload nested in a content string", async () => {
    mockFetchJson({
      message: {
        content: JSON.stringify({
          risk: "high",
          is_exploitable: true,
          summary: "Key is exposed",
          recommendation: "Rotate it",
        }),
      },
    });

    const result = await explainFinding(finding, hunk);
    expect(result.risk).toBe("high");
    expect(result.recommendation).toBe("Rotate it");
  });

  it("throws (so callers fall back) when the response fails schema validation", async () => {
    mockFetchJson({ message: { content: JSON.stringify({ risk: "not-a-severity" }) } });
    await expect(explainFinding(finding, hunk)).rejects.toThrow();
  });

  it("throws when BACKBOARD_API_KEY is missing", async () => {
    delete process.env.BACKBOARD_API_KEY;
    mockFetchJson({});
    await expect(explainFinding(finding, hunk)).rejects.toThrow(/BACKBOARD_API_KEY/);
  });
});
