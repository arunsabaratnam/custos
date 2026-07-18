import { describe, expect, it } from "vitest";
import { buildFindingContext } from "../../src/auth/claimsBuilder.js";
import type { Finding } from "../../src/scanner/types.js";

const finding: Finding = {
  id: "hardcoded-api-key",
  severity: "critical",
  category: "secret",
  title: "Hardcoded API key detected",
  file: "src/server.ts",
  line: 12,
  evidence: 'const OPENAI_API_KEY = "sk-demo-leaked-key";',
  explanation: "leaked",
  recommendation: "use env",
  source: "rule",
};

describe("buildFindingContext", () => {
  it("maps a finding into namespaced claim keys", () => {
    const ctx = buildFindingContext(finding, "a3f9c1d", "deadline blocker");
    expect(ctx).toEqual({
      "https://custos/finding_id": "hardcoded-api-key",
      "https://custos/severity": "critical",
      "https://custos/rule": "hardcoded-api-key",
      "https://custos/file": "src/server.ts",
      "https://custos/line": 12,
      "https://custos/commit_sha": "a3f9c1d",
      "https://custos/override_reason": "deadline blocker",
    });
  });

  it("omits optional keys when line/commit are absent", () => {
    const { line, ...rest } = finding;
    void line;
    const ctx = buildFindingContext(rest as Finding, undefined, "reason");
    expect("https://custos/line" in ctx).toBe(false);
    expect("https://custos/commit_sha" in ctx).toBe(false);
    expect(ctx["https://custos/override_reason"]).toBe("reason");
  });
});
