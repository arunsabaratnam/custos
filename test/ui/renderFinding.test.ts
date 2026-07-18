import { afterAll, describe, expect, it, vi } from "vitest";
import { renderFinding } from "../../src/ui/renderFinding.js";
import type { Finding } from "../../src/scanner/types.js";

const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

const finding: Finding = {
  id: "abc12345",
  severity: "critical",
  category: "secret",
  title: "Hardcoded API key detected",
  file: "src/server.ts",
  line: 12,
  evidence: 'const OPENAI_API_KEY = "sk-demo-leaked-key";',
  explanation: "This API key will be exposed in the remote repository.",
  recommendation: "Move the secret to process.env.OPENAI_API_KEY.",
  source: "rule",
};

describe("renderFinding", () => {
  afterAll(() => {
    logSpy.mockRestore();
  });

  it("does not throw for a critical finding", () => {
    expect(() => renderFinding(finding)).not.toThrow();
  });

  it("does not throw for a low finding", () => {
    expect(() => renderFinding({ ...finding, severity: "low" })).not.toThrow();
  });
});
