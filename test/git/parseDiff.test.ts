import { describe, it, expect } from "vitest";
import { parseDiff } from "../../src/git/parseDiff.js";

const SAMPLE_DIFF = `diff --git a/src/server.ts b/src/server.ts
index abc1234..def5678 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -1,4 +1,6 @@
 import express from 'express';
+const OPENAI_API_KEY = "sk-demo-leaked-key";
+const DB_PASSWORD = "hunter2";
 
 const app = express();
 app.listen(3000);
`;

describe("parseDiff", () => {
  it("returns one hunk for a single file change", () => {
    expect(parseDiff(SAMPLE_DIFF)).toHaveLength(1);
  });

  it("identifies the correct file", () => {
    expect(parseDiff(SAMPLE_DIFF)[0]?.file).toBe("src/server.ts");
  });

  it("detects typescript language", () => {
    expect(parseDiff(SAMPLE_DIFF)[0]?.language).toBe("typescript");
  });

  it("extracts only added lines", () => {
    const hunk = parseDiff(SAMPLE_DIFF)[0]!;
    expect(hunk.addedLines).toHaveLength(2);
    expect(hunk.addedLines[0]?.content).toBe('const OPENAI_API_KEY = "sk-demo-leaked-key";');
    expect(hunk.addedLines[1]?.content).toBe('const DB_PASSWORD = "hunter2";');
  });

  it("returns empty array for empty diff", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("returns empty array when no lines are added", () => {
    const removalsOnly = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,2 @@
 const a = 1;
-const b = 2;
 const c = 3;
`;
    expect(parseDiff(removalsOnly)).toEqual([]);
  });
});
