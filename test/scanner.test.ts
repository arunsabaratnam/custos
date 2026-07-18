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

function hunk(content: string, opts: Partial<DiffHunk> = {}): DiffHunk {
  return {
    file: opts.file ?? "src/app.ts",
    language: opts.language ?? "typescript",
    addedLines: [{ line: 1, content }],
    context: opts.context ?? "",
    ...(opts.addedLines ? { addedLines: opts.addedLines } : {}),
  };
}

describe("scanner rules", () => {
  it("detects the canonical demo hardcoded API key as critical with a patch", () => {
    const findings = scanDiff([sampleHunk]);
    const finding = findings.find((f) => f.id === "hardcoded-api-key");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
    expect(finding!.category).toBe("secret");
    expect(finding!.line).toBe(12);
    expect(finding!.patch).toBe("const OPENAI_API_KEY = process.env.OPENAI_API_KEY;");
  });

  it("flags SQL string concatenation with user input and parameterizes it", () => {
    const finding = scanDiff([
      hunk('const u = await db.query("SELECT * FROM users WHERE id = " + req.query.id);'),
    ]).find((f) => f.id === "sql-injection");
    expect(finding?.severity).toBe("critical");
    expect(finding?.patch).toBe(
      'const u = await db.query("SELECT * FROM users WHERE id = ?", [req.query.id]);',
    );
  });

  it("flags private keys, eval, and dangerous exec", () => {
    expect(scanDiff([hunk("-----BEGIN RSA PRIVATE KEY-----")]).some((f) => f.id === "private-key-in-source")).toBe(true);
    expect(scanDiff([hunk("const r = eval(userInput);")]).some((f) => f.id === "eval-usage")).toBe(true);
    expect(scanDiff([hunk("exec(`ls ${req.query.dir}`);")]).some((f) => f.id === "dangerous-exec")).toBe(true);
  });

  it("flags .env files and wildcard CORS with credentials", () => {
    const dotenv = hunk("SECRET_KEY=super-secret-value", { file: ".env", language: "dotenv" });
    expect(scanDiff([dotenv]).some((f) => f.id === "dotenv-committed")).toBe(true);

    const cors: DiffHunk = {
      file: "src/server.ts",
      language: "typescript",
      addedLines: [
        { line: 1, content: 'app.use(cors({ origin: "*", credentials: true }));' },
      ],
      context: "",
    };
    expect(scanDiff([cors]).some((f) => f.id === "wildcard-cors-credentials")).toBe(true);
  });

  it("does not flag values sourced from process.env", () => {
    const findings = scanDiff([hunk("const OPENAI_API_KEY = process.env.OPENAI_API_KEY;")]);
    expect(findings).toEqual([]);
  });

  it("returns no findings for benign code", () => {
    expect(scanDiff([hunk("const sum = a + b;")])).toEqual([]);
  });

  it("every rule is a function", () => {
    for (const rule of rules) {
      expect(typeof rule).toBe("function");
    }
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
