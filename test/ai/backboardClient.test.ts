import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichSecurityFindings, explainFinding, reviewSecurityContext } from "../../src/ai/backboardClient.js";
import type { AiScanContext } from "../../src/context/buildScanContext.js";
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

const scanContext: AiScanContext = {
  version: 1,
  files: [
    {
      path: "src/server.ts",
      language: "typescript",
      addedLines: [{ line: 12, content: 'const KEY = "[REDACTED]";' }],
      nearbyContext: "",
    },
  ],
  knownFindings: [],
  limits: { maxFindings: 5, timeoutMs: 10_000 },
  omittedFileCount: 0,
};

function mockFetchJson(payload: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? "OK" : "Error",
      headers: { get: () => null },
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
    delete process.env.BACKBOARD_ASSISTANT_ID;
    delete process.env.BACKBOARD_SCAN_ASSISTANT_ID;
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

  it("requests a bounded, structured independent security review", async () => {
    process.env.BACKBOARD_ASSISTANT_ID = "general-assistant-with-rag";
    mockFetchJson({
      content: JSON.stringify({
        findings: [
          {
            severity: "critical",
            category: "secret",
            title: "Hardcoded credential",
            file: "src/server.ts",
            line: 12,
            evidence: 'const KEY = "[REDACTED]";',
            explanation: "The credential would be exposed in source control.",
            recommendation: "Move it to an environment variable and rotate it.",
            confidence: 0.98,
            exploitability: "high",
            trustBoundary: "source control",
          },
        ],
      }),
    });

    const result = await reviewSecurityContext(scanContext);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.confidence).toBe(0.98);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/threads/messages"),
      expect.objectContaining({ body: expect.stringContaining('"memory":"off"') }),
    );
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).not.toHaveProperty("assistant_id");
    expect(String(JSON.parse(String(request?.body)).system_prompt)).toContain("MUST return one matching entry");
  });

  it("uses only an explicitly configured clean scan assistant", async () => {
    process.env.BACKBOARD_SCAN_ASSISTANT_ID = "clean-security-scan-assistant";
    mockFetchJson({ findings: [] });

    await reviewSecurityContext(scanContext);

    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      assistant_id: "clean-security-scan-assistant",
      memory: "off",
      web_search: "off",
    });
  });

  it("enriches confirmed findings in a separate compact request", async () => {
    mockFetchJson({
      findings: [{
        severity: "critical",
        category: "secret",
        title: "Hardcoded API key detected",
        file: "src/server.ts",
        line: 12,
        evidence: 'const KEY = "[REDACTED]";',
        explanation: "The credential would be exposed in source control.",
        recommendation: "Move it to a secret store and rotate it.",
        confidence: 0.98,
        exploitability: "high",
        trustBoundary: "source control",
      }],
    });

    const result = await enrichSecurityFindings({
      ...scanContext,
      knownFindings: [{
        id: "hardcoded-api-key",
        severity: "critical",
        category: "secret",
        title: "Hardcoded API key detected",
        file: "src/server.ts",
        line: 12,
        evidence: 'const KEY = "[REDACTED]";',
      }],
    });

    expect(result.findings).toHaveLength(1);
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(String(JSON.parse(String(request?.body)).system_prompt)).toContain("confirmed policy violation");
  });

  it("accepts fenced JSON and optional fields omitted by a model", async () => {
    mockFetchJson({
      content: "Here is the review:\n```json\n" + JSON.stringify({
        findings: [{
          severity: "high",
          category: "auth",
          title: "Authorization check may be missing",
          file: "src/server.ts",
          line: "12",
          evidence: "requireAuth(req)",
          explanation: "The route may be reachable without an authorization check.",
          recommendation: "Verify authorization before accessing the resource.",
          confidence: "0.86",
        }],
      }) + "\n```",
    });

    const result = await reviewSecurityContext({
      ...scanContext,
      files: [{ ...scanContext.files[0]!, addedLines: [{ line: 12, content: "requireAuth(req)" }] }],
    });

    expect(result.findings[0]).toMatchObject({ confidence: 0.86, exploitability: "unknown" });
  });

  it("normalizes common response aliases and defaults omitted confidence", async () => {
    mockFetchJson({
      content: JSON.stringify({
        issues: [{
          severity: "HIGH",
          category: "credentials",
          title: "Credential exposed in source",
          file: "src/server.ts",
          line: 12,
          evidence: 'const KEY = "[REDACTED]";',
          explanation: "The credential can be recovered from source control.",
          recommendation: "Move it to a secret store and rotate it.",
        }],
      }),
    });

    const result = await reviewSecurityContext(scanContext);

    expect(result.findings[0]).toMatchObject({ severity: "high", category: "secret", confidence: 0.75 });
  });

  it("normalizes percentage confidence values", async () => {
    mockFetchJson({
      findings: [{
        severity: "high",
        category: "secret",
        title: "Credential exposed in source",
        file: "src/server.ts",
        line: 12,
        evidence: 'const KEY = "[REDACTED]";',
        explanation: "The credential can be recovered from source control.",
        recommendation: "Move it to a secret store and rotate it.",
        confidence: 95,
      }],
    });

    const result = await reviewSecurityContext(scanContext);

    expect(result.findings[0]?.confidence).toBe(0.95);
  });

  it("retries one rate-limited response before failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests", headers: { get: () => "0.001" } })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: { get: () => null },
          json: async () => ({ findings: [] }),
        }) as unknown as typeof fetch,
    );

    await expect(reviewSecurityContext(scanContext)).resolves.toEqual({ findings: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
