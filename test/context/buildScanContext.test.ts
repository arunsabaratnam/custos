import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildScanContext, readAiScanLimits } from "../../src/context/buildScanContext.js";
import type { DiffHunk, Finding } from "../../src/scanner/types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "custos-context-test-"));
  await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { express: "^5.0.0" } }));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("buildScanContext", () => {
  it("bounds files and lines, excludes sensitive files, and redacts token values", async () => {
    const hunks: DiffHunk[] = [
      {
        file: "src/server.ts",
        language: "typescript",
        addedLines: [
          { line: 4, content: 'const OPENAI_API_KEY = "sk-demo-leaked-key";' },
          { line: 5, content: "app.listen(3000);" },
        ],
        context: "import express from 'express';",
      },
      {
        file: ".env",
        language: "dotenv",
        addedLines: [{ line: 1, content: "DATABASE_PASSWORD=top-secret" }],
        context: "",
      },
      {
        file: "src/ignored.ts",
        language: "typescript",
        addedLines: [{ line: 1, content: "export const ignored = true;" }],
        context: "",
      },
    ];

    const context = await buildScanContext(hunks, tmpDir, {
      maxFiles: 1,
      maxLinesPerFile: 1,
      maxFindings: 3,
      timeoutMs: 5_000,
    });

    expect(context.files).toHaveLength(1);
    expect(context.files[0]?.path).toBe("src/server.ts");
    expect(context.files[0]?.addedLines).toEqual([{ line: 4, content: 'const OPENAI_API_KEY = "[REDACTED]";' }]);
    expect(JSON.stringify(context)).not.toContain("sk-demo-leaked-key");
    expect(JSON.stringify(context)).not.toContain("top-secret");
    expect(context.dependencyManifest?.excerpt).toContain("express");
  });

  it("includes a redacted, bounded view of known deterministic findings", async () => {
    const findings: Finding[] = [{
      id: "hardcoded-api-key",
      severity: "critical",
      category: "secret",
      title: "Hardcoded API key detected",
      file: ".env.example",
      line: 3,
      evidence: 'BACKBOARD_API_KEY="sk-demo-leaked-key"',
      explanation: "",
      recommendation: "",
      source: "rule",
    }];

    const context = await buildScanContext([], tmpDir, {
      maxFiles: 1,
      maxLinesPerFile: 1,
      maxFindings: 1,
      timeoutMs: 5_000,
    }, findings);

    expect(context.knownFindings).toHaveLength(1);
    expect(JSON.stringify(context.knownFindings)).not.toContain("sk-demo-leaked-key");
  });

  it("uses safe defaults for invalid environment limits", () => {
    expect(readAiScanLimits({ CUSTOS_AI_MAX_FILES: "not-a-number", CUSTOS_AI_TIMEOUT_MS: "1" } as NodeJS.ProcessEnv)).toMatchObject({
      maxFiles: 5,
      timeoutMs: 10_000,
    });
  });
});
