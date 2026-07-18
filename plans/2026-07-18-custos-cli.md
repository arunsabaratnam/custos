# Custos CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a terminal-native `custos` CLI that intercepts `git push`, scans the outgoing diff for security vulnerabilities, offers AI-assisted patches, and requires Auth0-authenticated accountability for critical overrides — all logged to MongoDB Atlas.

**Architecture:** Layer 1 (Tasks 1–5) builds the complete core loop end-to-end: diff extraction → UI → init → scan orchestration. Layer 2 (Tasks 6–9) adds integrations as independent slices. The hook never crashes due to a missing integration; all integrations are gated on environment variables.

**Tech Stack:** Node.js 18+, TypeScript 5, ESM with `NodeNext` module resolution, Commander (CLI), @clack/prompts (interactive UI), Chalk + Boxen (terminal styling), Zod (validation), Mongoose (MongoDB), Vitest (tests). Test files live in `test/` (not `tests/`).

## Global Constraints

- Node.js >= 18 required (native fetch, `Buffer.from(..., 'base64url')`)
- All imports must include `.js` extension (NodeNext resolution)
- `"type": "module"` in package.json — ESM throughout
- The pre-push hook must exit 0 (allow) or 1 (block) — never crash with an unhandled exception
- AI enrichment, Auth0, and MongoDB are all optional at runtime; missing env vars skip the feature with a warning
- `src/scanner/rules.ts` and `src/ai/prompts.ts` are human-owned — never implement detection logic or prompts speculatively
- All external API responses validated with Zod before use
- Patch application always exits 1 — never silently patch and allow the same push

## What Is Already Done

The following are fully scaffolded and require no further work:

- **`package.json`** — all dependencies installed, scripts wired (`dev`, `build`, `test`, `lint`, `typecheck`)
- **`tsconfig.json` / `tsconfig.build.json`** — NodeNext module resolution, strict mode
- **`eslint.config.js`** — linting configured
- **`src/cli.ts`** — Commander program with all 4 commands registered, calling `runInit`, `runScan`, `runAudit`, `runDoctor`
- **`src/scanner/types.ts`** — `Severity`, `Finding`, `DiffHunk`, `AuditEventType`, `AuditAction`, `AuditEvent` types
- **`src/scanner/rules.ts`** — 9 stub rules (all return null), `Rule` type, `rules[]` export
- **`src/scanner/scanDiff.ts`** — `scanDiff(hunks: DiffHunk[]): Finding[]` fully implemented
- **`src/ui/theme.ts`** — `severityColor: Record<Severity, fn>` and `boxenTheme` exported
- **`src/ai/schemas.ts`** — `explainResponseSchema`, `patchResponseSchema`, `severitySchema` with Zod
- **`src/audit/model.ts`** — `auditEventSchema` (Mongoose schema, not model)
- **`src/auth/claimsBuilder.ts`** — `FindingContext` type and `buildFindingContext` stub
- **`src/auth/deviceFlow.ts`** — `DeviceCodeResponse`, `DeviceFlowResult` types and `requestDeviceCode`/`pollForToken` stubs
- **`test/cli.test.ts`** — CLI help output test
- **`test/scanner.test.ts`** — stub rules, scanDiff, Finding shape, schema validation tests

The stubs listed above throw `new Error("...: not implemented")` or print "not implemented yet." Every task below targets one or more of those stubs.

## Existing Interfaces to Match

All tasks must use these exact signatures — they are defined in already-committed files:

```ts
// src/scanner/types.ts
type Severity = "low" | "medium" | "high" | "critical"
type Finding = { id, severity, category, title, file, line?, evidence, explanation, recommendation, patch?, source }
type DiffHunk = { file, language, addedLines: Array<{line, content}>, context }
type AuditEvent = { eventType, repoName, repoPathHash, branch?, commitSha?, userId?, userEmail?, finding?, overrideReason?, jwtClaims?, action, createdAt }
type AuditEventType = "scan_passed" | "finding_detected" | "finding_blocked" | "patch_applied" | "override_requested" | "override_approved" | "override_denied"
type AuditAction = "allowed" | "blocked" | "patched" | "overridden"

// src/scanner/rules.ts
type Rule = (hunk: DiffHunk) => Finding | null

// src/ui/theme.ts
severityColor: Record<Severity, (text: string) => string>
boxenTheme: { padding: number; borderColor: string; borderStyle: "round" }

// src/ui/prompts.ts (stub)
type FindingAction = "apply-patch" | "view-details" | "override" | "abort"
promptFindingAction(): Promise<FindingAction>
promptOverrideReason(): Promise<string>

// src/ai/schemas.ts
explainResponseSchema → { risk: Severity, is_exploitable: boolean, summary: string, recommendation: string }
patchResponseSchema → { patch: string, explanation: string }

// src/ai/prompts.ts (human-owned stubs)
type ModelSelection = { llm_provider: string; model_name: string }
type BackboardPromptContext = { finding: Finding; hunk: DiffHunk; ruleName: string }
getExplainModel(): ModelSelection      — throws, human fills in
getPatchModel(): ModelSelection        — throws, human fills in
buildExplainPrompt(ctx): string        — throws, human fills in
buildPatchPrompt(ctx): string          — throws, human fills in

// src/ai/backboardClient.ts (stub)
explainFinding(finding, hunk): Promise<ExplainResponse>
generatePatch(finding, hunk): Promise<PatchResponse>

// src/audit/mongo.ts (stub)
connectMongo(): Promise<Connection>
disconnectMongo(): Promise<void>

// src/audit/writeAudit.ts (stub)
writeAuditEvent(event: AuditEvent): Promise<void>
listAuditEvents(limit?: number): Promise<AuditEvent[]>

// src/auth/claimsBuilder.ts (stub)
type FindingContext = { "https://custos/finding_id", "https://custos/severity", "https://custos/rule", "https://custos/file", "https://custos/line"?, "https://custos/commit_sha"?, "https://custos/override_reason" }
buildFindingContext(finding, commitSha, overrideReason): FindingContext

// src/auth/deviceFlow.ts (stub)
type DeviceCodeResponse = { device_code, user_code, verification_uri, verification_uri_complete?, expires_in, interval }
type DeviceFlowResult = { accessToken: string; claims: Record<string, unknown> }
requestDeviceCode(findingContext: FindingContext): Promise<DeviceCodeResponse>
pollForToken(deviceCode: string, interval: number): Promise<DeviceFlowResult>

// src/commands/init.ts (stub)
runInit(): Promise<void>

// src/commands/scan.ts (stub)
type ScanOptions = { prePush?: boolean; json?: boolean }
runScan(options: ScanOptions): Promise<void>

// src/commands/audit.ts (stub)
runAudit(): Promise<void>

// src/commands/doctor.ts (stub)
runDoctor(): Promise<void>
```

---

## Phase 1 — Core Loop

---

### Task 1: Git Diff Extraction and Parsing

**Files:**
- Modify: `src/git/getDiff.ts` (replace stub)
- Modify: `src/git/parseDiff.ts` (replace stub)
- Create: `test/git/parseDiff.test.ts`

**Interfaces:**
- Consumes: `DiffHunk` from `src/scanner/types.ts`
- Produces:
  - `getDiff(stdin?: string): Promise<string>` — reads stdin refs in pre-push mode, falls back to git diff commands
  - `parseDiff(rawDiff: string): DiffHunk[]` — unified diff → structured hunks

- [x] **Step 1: Write the failing test**

`test/git/parseDiff.test.ts`:
```ts
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
```

- [x] **Step 2: Run test to verify it fails**

```bash
npm test -- test/git/parseDiff.test.ts
```

Expected: FAIL — `parseDiff: not implemented`

- [x] **Step 3: Implement src/git/parseDiff.ts**

```ts
import path from "path";
import type { DiffHunk } from "../scanner/types.js";

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".env": "dotenv",
  ".sh": "bash",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".sql": "sql",
};

export function parseDiff(rawDiff: string): DiffHunk[] {
  if (!rawDiff.trim()) return [];

  const hunks: DiffHunk[] = [];
  const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const fileMatch = section.match(/^a\/.+ b\/(.+)\n/);
    if (!fileMatch) continue;

    const file = fileMatch[1]!.trim();
    const ext = path.extname(file);
    const language = LANGUAGE_MAP[ext] ?? "unknown";

    const hunkHeaders = [...section.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)];
    const hunkBodies = section.split(/^@@ [^@]+ @@[^\n]*/m).slice(1);

    hunkBodies.forEach((body, i) => {
      const startLine = hunkHeaders[i] ? parseInt(hunkHeaders[i]![1]!, 10) : 1;
      let lineNum = startLine;
      const addedLines: Array<{ line: number; content: string }> = [];
      const contextLines: string[] = [];

      for (const line of body.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          addedLines.push({ line: lineNum, content: line.slice(1) });
          lineNum++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          // removed line — don't advance lineNum
        } else if (line !== "\\ No newline at end of file") {
          contextLines.push(line);
          lineNum++;
        }
      }

      if (addedLines.length > 0) {
        hunks.push({
          file,
          language,
          addedLines,
          context: contextLines.slice(0, 10).join("\n"),
        });
      }
    });
  }

  return hunks;
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npm test -- test/git/parseDiff.test.ts
```

Expected: PASS (6 tests)

- [x] **Step 5: Implement src/git/getDiff.ts**

```ts
import { execa } from "execa";

// Empty tree SHA — used to diff against nothing for brand-new branches
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Extracts the raw unified diff of commits being pushed.
 *
 * In pre-push mode, Git pipes stdin lines of the form:
 *   <local-ref> <local-sha> <remote-ref> <remote-sha>
 * Pass that stdin string here. Falls back to common diff strategies
 * for manual scans.
 */
export async function getDiff(stdin?: string): Promise<string> {
  if (stdin?.trim()) {
    const parts = stdin.trim().split(/\s+/);
    if (parts.length >= 4) {
      const localSha = parts[1]!;
      const remoteSha = parts[3]!;
      const base = /^0+$/.test(remoteSha) ? EMPTY_TREE : remoteSha;
      try {
        const { stdout } = await execa("git", ["diff", "--unified=3", `${base}...${localSha}`]);
        if (stdout) return stdout;
      } catch {}
    }
  }

  // Manual scan fallbacks
  for (const args of [
    ["diff", "--unified=3", "origin/main...HEAD"],
    ["diff", "--unified=3", "HEAD~1..HEAD"],
    ["diff", "--unified=3", "HEAD"],
  ]) {
    try {
      const { stdout } = await execa("git", args);
      if (stdout) return stdout;
    } catch {}
  }

  return "";
}
```

- [x] **Step 6: Commit**

```bash
git add src/git/getDiff.ts src/git/parseDiff.ts test/git/parseDiff.test.ts
git commit -m "feat: implement git diff extraction and parser"
```

---

### Task 2: Terminal UI

**Files:**
- Modify: `src/ui/renderFinding.ts` (replace stub)
- Modify: `src/ui/prompts.ts` (replace stub)
- Create: `test/ui/renderFinding.test.ts`

**Interfaces:**
- Consumes: `Finding` from `src/scanner/types.ts`; `severityColor`, `boxenTheme` from `src/ui/theme.ts`
- Produces:
  - `renderFinding(finding: Finding): void`
  - `promptFindingAction(): Promise<FindingAction>` — note: no finding argument (matches existing stub signature)
  - `promptOverrideReason(): Promise<string>`

- [x] **Step 1: Write the failing test**

`test/ui/renderFinding.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

// renderFinding writes to stdout — capture it
const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

import { renderFinding } from "../../src/ui/renderFinding.js";
import type { Finding } from "../../src/scanner/types.js";

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
  it("does not throw for a critical finding", () => {
    expect(() => renderFinding(finding)).not.toThrow();
  });

  it("does not throw for a low finding", () => {
    expect(() => renderFinding({ ...finding, severity: "low" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/ui/renderFinding.test.ts
```

Expected: FAIL — `renderFinding: not implemented`

- [x] **Step 3: Implement src/ui/renderFinding.ts**

```ts
import boxen from "boxen";
import chalk from "chalk";
import type { Finding } from "../scanner/types.js";
import { severityColor, boxenTheme } from "./theme.js";

export function renderFinding(finding: Finding): void {
  const colorFn = severityColor[finding.severity];
  const badge = colorFn(` ${finding.severity.toUpperCase()} `);
  const location = `${chalk.cyan(finding.file)}${finding.line ? `:${finding.line}` : ""}`;

  const body = [
    `${badge}  ${chalk.bold(finding.title)}`,
    location,
    "",
    chalk.bold("Why this matters:"),
    finding.explanation,
    "",
    chalk.bold("Suggested fix:"),
    finding.recommendation,
  ].join("\n");

  console.log(
    boxen(body, {
      ...boxenTheme,
      borderStyle: finding.severity === "critical" ? "double" : "round",
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
    })
  );
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npm test -- test/ui/renderFinding.test.ts
```

Expected: PASS (2 tests)

- [x] **Step 5: Implement src/ui/prompts.ts**

```ts
import * as clack from "@clack/prompts";

export type FindingAction = "apply-patch" | "view-details" | "override" | "abort";

export async function promptFindingAction(hasPatch: boolean): Promise<FindingAction> {
  const result = await clack.select({
    message: "What do you want to do?",
    options: [
      ...(hasPatch ? [{ value: "apply-patch", label: "Apply suggested patch" }] : []),
      { value: "view-details", label: "View technical details" },
      { value: "override", label: "Force override with Auth0" },
      { value: "abort", label: "Abort push" },
    ],
  });

  if (clack.isCancel(result)) return "abort";
  return result as FindingAction;
}

export async function promptOverrideReason(): Promise<string> {
  const result = await clack.text({
    message: "Why are you overriding this finding? (required for audit log)",
    placeholder: "e.g., key is already rotated, not in production path",
    validate: (v) => (!v.trim() ? "A reason is required to override." : undefined),
  });

  if (clack.isCancel(result)) return "";
  return (result as string).trim();
}
```

Note: `promptFindingAction` takes a `hasPatch: boolean` parameter — callers pass whether a patch is available, which controls whether the "Apply patch" option appears.

- [x] **Step 6: Smoke-test rendering manually**

Create a temporary file at the project root `smoke.ts`:

```ts
import "./src/cli.js"; // ensure dotenv loads
import { renderFinding } from "./src/ui/renderFinding.js";

renderFinding({
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
});
```

```bash
npx tsx smoke.ts
```

Expected: boxed terminal output with red double-border, CRITICAL badge, file:line, explanation, and fix. Delete `smoke.ts` after verifying.

- [ ] **Step 7: Commit**

```bash
git add src/ui/renderFinding.ts src/ui/prompts.ts test/ui/renderFinding.test.ts
git commit -m "feat: implement terminal UI — finding renderer and action prompts"
```

---

### Task 3: custos init

**Files:**
- Modify: `src/commands/init.ts` (replace stub)
- Create: `test/commands/init.test.ts`

**Interfaces:**
- Produces: `runInit(): Promise<void>`

- [x] **Step 1: Write the failing test**

`test/commands/init.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import fs from "fs/promises";
import path from "path";
import os from "os";

async function setupTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "custos-init-test-"));
  await execa("git", ["init"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

describe("runInit", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await setupTempRepo();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a pre-push hook containing custos scan --pre-push", async () => {
    await execa("npx", ["tsx", path.resolve("src/cli.ts"), "init"], { cwd: tmpDir });
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
    const content = await fs.readFile(hookPath, "utf8");
    expect(content).toContain("custos scan --pre-push");
  });

  it("makes the hook executable", async () => {
    await execa("npx", ["tsx", path.resolve("src/cli.ts"), "init"], { cwd: tmpDir });
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
    const stat = await fs.stat(hookPath);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it("preserves existing hook content when custos line is not yet present", async () => {
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(
      path.join(hooksDir, "pre-push"),
      "#!/bin/sh\necho 'existing hook'\n"
    );
    await execa("npx", ["tsx", path.resolve("src/cli.ts"), "init"], { cwd: tmpDir });
    const content = await fs.readFile(path.join(hooksDir, "pre-push"), "utf8");
    expect(content).toContain("existing hook");
    expect(content).toContain("custos scan --pre-push");
  });

  it("does not duplicate the custos line if already present", async () => {
    await execa("npx", ["tsx", path.resolve("src/cli.ts"), "init"], { cwd: tmpDir });
    await execa("npx", ["tsx", path.resolve("src/cli.ts"), "init"], { cwd: tmpDir });
    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
    const content = await fs.readFile(hookPath, "utf8");
    const count = (content.match(/custos scan --pre-push/g) ?? []).length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/commands/init.test.ts
```

Expected: FAIL — init prints "not implemented yet"

- [x] **Step 3: Implement src/commands/init.ts**

```ts
import { execa } from "execa";
import fs from "fs/promises";
import path from "path";
import chalk from "chalk";

const HOOK_LINE = "custos scan --pre-push";
const HOOK_SHEBANG = "#!/bin/sh";

export async function runInit(): Promise<void> {
  try {
    await execa("git", ["rev-parse", "--git-dir"]);
  } catch {
    console.error(chalk.red("Error: Not inside a Git repository."));
    process.exit(1);
  }

  const { stdout: gitDir } = await execa("git", ["rev-parse", "--git-dir"]);
  const hooksDir = path.resolve(gitDir.trim(), "hooks");
  const hookPath = path.join(hooksDir, "pre-push");

  await fs.mkdir(hooksDir, { recursive: true });

  let existingContent = "";
  try {
    existingContent = await fs.readFile(hookPath, "utf8");
  } catch {}

  if (existingContent.includes(HOOK_LINE)) {
    console.log(chalk.dim("Custos pre-push hook already installed."));
    return;
  }

  let newContent: string;
  if (existingContent && existingContent.startsWith(HOOK_SHEBANG)) {
    // Inject after the shebang line
    const lines = existingContent.split("\n");
    lines.splice(1, 0, HOOK_LINE);
    newContent = lines.join("\n");
  } else if (existingContent) {
    newContent = `${HOOK_SHEBANG}\n${HOOK_LINE}\n\n${existingContent}`;
  } else {
    newContent = `${HOOK_SHEBANG}\n${HOOK_LINE}\n`;
  }

  await fs.writeFile(hookPath, newContent, "utf8");
  await fs.chmod(hookPath, 0o755);

  console.log(chalk.green("✓ Custos installed pre-push protection for this repository."));
  console.log(chalk.dim(`  Future git push attempts will run: ${HOOK_LINE}`));
  console.log(chalk.dim(`  To remove: delete ${hookPath}`));
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npm test -- test/commands/init.test.ts
```

Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add src/commands/init.ts test/commands/init.test.ts
git commit -m "feat: implement custos init — installs pre-push hook"
```

---

### Task 4: custos scan (Core Loop Orchestration)

**Files:**
- Modify: `src/commands/scan.ts` (replace stub)

**Interfaces:**
- Consumes: `getDiff`, `parseDiff`, `scanDiff`, `renderFinding`, `promptFindingAction`, `promptOverrideReason` — all now implemented
- Integration callsites (`connectMongo`, `writeAuditEvent`, `explainFinding`, `generatePatch`, `requestDeviceCode`, `pollForToken`, `buildFindingContext`) are guarded — if the module throws on import or at call time, the hook falls back gracefully
- Produces: `runScan(options: ScanOptions): Promise<void>` — exit 0 allow / exit 1 block

- [ ] **Step 1: Implement src/commands/scan.ts**

```ts
import * as clack from "@clack/prompts";
import chalk from "chalk";
import fs from "fs/promises";
import { getDiff } from "../git/getDiff.js";
import { parseDiff } from "../git/parseDiff.js";
import { scanDiff } from "../scanner/scanDiff.js";
import type { DiffHunk, Finding } from "../scanner/types.js";
import { renderFinding } from "../ui/renderFinding.js";
import { promptFindingAction, promptOverrideReason } from "../ui/prompts.js";

export type ScanOptions = {
  prePush?: boolean;
  json?: boolean;
};

// Integration callsites — each is wrapped so a missing implementation
// (throws "not implemented") degrades gracefully rather than crashing the hook.

async function tryConnectMongo(): Promise<boolean> {
  try {
    const { connectMongo } = await import("../audit/mongo.js");
    await connectMongo();
    return true;
  } catch {
    return false;
  }
}

async function tryWriteAudit(event: Record<string, unknown>): Promise<void> {
  try {
    const { writeAuditEvent } = await import("../audit/writeAudit.js");
    await writeAuditEvent(event as Parameters<typeof writeAuditEvent>[0]);
  } catch {}
}

async function tryEnrichFinding(finding: Finding, hunk: DiffHunk): Promise<Partial<Finding>> {
  try {
    const { explainFinding } = await import("../ai/backboardClient.js");
    const result = await explainFinding(finding, hunk);
    return {
      severity: result.risk,
      explanation: result.summary,
      recommendation: result.recommendation,
      source: "hybrid" as const,
    };
  } catch {
    return {};
  }
}

async function tryGeneratePatch(finding: Finding, hunk: DiffHunk): Promise<string | null> {
  try {
    const { generatePatch } = await import("../ai/backboardClient.js");
    const result = await generatePatch(finding, hunk);
    return result.patch;
  } catch {
    return null;
  }
}

async function tryOverride(
  finding: Finding,
  reason: string,
  commitSha: string | undefined
): Promise<{ success: boolean; claims: Record<string, unknown>; userEmail?: string }> {
  try {
    const { buildFindingContext } = await import("../auth/claimsBuilder.js");
    const { requestDeviceCode, pollForToken } = await import("../auth/deviceFlow.js");

    const context = buildFindingContext(finding, commitSha, reason);
    const deviceCode = await requestDeviceCode(context);

    console.log("");
    console.log(chalk.bold("Verify your identity to override this finding."));
    console.log("");
    console.log(`  Visit:  ${chalk.cyan(deviceCode.verification_uri)}`);
    console.log(`  Code:   ${chalk.bold.yellow(deviceCode.user_code)}`);
    console.log("");

    try {
      const { default: open } = await import("open");
      await open(deviceCode.verification_uri_complete ?? deviceCode.verification_uri);
      console.log(chalk.dim("  (Browser opened automatically)"));
    } catch {}

    console.log(chalk.dim("  Waiting for verification...\n"));

    const result = await pollForToken(deviceCode.device_code, deviceCode.interval);
    const email = String(result.claims["email"] ?? result.claims["https://custos/email"] ?? "");
    return { success: true, claims: result.claims, userEmail: email || undefined };
  } catch (err) {
    console.error(chalk.red(`[custos] Override failed: ${(err as Error).message}`));
    return { success: false, claims: {} };
  }
}

const BLOCK_ON = (process.env.CUSTOS_BLOCK_ON ?? "critical,high")
  .split(",")
  .map((s) => s.trim());

const AI_ENABLED =
  process.env.CUSTOS_AI_PATCHES !== "false" && Boolean(process.env.BACKBOARD_API_KEY);

export async function runScan(options: ScanOptions): Promise<void> {
  const { prePush = false, json = false } = options;

  try {
    await tryConnectMongo();

    // Read stdin in pre-push mode (Git pipes ref pairs on stdin)
    let stdin: string | undefined;
    if (prePush && !process.stdin.isTTY) {
      stdin = await new Promise<string>((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { data += chunk; });
        process.stdin.on("end", () => resolve(data));
      });
    }

    const rawDiff = await getDiff(stdin);
    if (!rawDiff.trim()) {
      if (!json) console.log(chalk.dim("No changes to scan."));
      process.exitCode = 0;
      return;
    }

    const hunks = parseDiff(rawDiff);
    let findings = scanDiff(hunks);

    if (findings.length === 0) {
      if (!json) console.log(chalk.green("✓ No security issues detected."));
      await tryWriteAudit({ eventType: "scan_passed", action: "allowed", createdAt: new Date() });
      process.exitCode = 0;
      return;
    }

    // AI enrichment — optional, skip if Backboard not configured
    if (AI_ENABLED && !json) {
      for (let i = 0; i < findings.length; i++) {
        const hunk = hunks.find((h) => h.file === findings[i]!.file);
        if (hunk) {
          const enriched = await tryEnrichFinding(findings[i]!, hunk);
          findings[i] = { ...findings[i]!, ...enriched };
        }
      }
    }

    if (json) {
      console.log(JSON.stringify(findings, null, 2));
      process.exitCode = findings.some((f) => BLOCK_ON.includes(f.severity)) ? 1 : 0;
      return;
    }

    // Render all findings
    for (const finding of findings) {
      renderFinding(finding);
      await tryWriteAudit({
        eventType: "finding_detected",
        finding,
        action: "blocked",
        createdAt: new Date(),
      });
    }

    const blocking = findings.filter((f) => BLOCK_ON.includes(f.severity));

    if (blocking.length === 0) {
      console.log(chalk.yellow("\n⚠  Warnings detected. Push allowed."));
      process.exitCode = 0;
      return;
    }

    console.log(
      chalk.red.bold(`\nCustos blocked this push. ${blocking.length} critical issue(s) require action.\n`)
    );

    // Get git commit SHA for audit record
    let commitSha: string | undefined;
    try {
      const { execa } = await import("execa");
      commitSha = (await execa("git", ["rev-parse", "HEAD"])).stdout.trim().slice(0, 7);
    } catch {}

    for (const finding of blocking) {
      const action = await promptFindingAction(Boolean(finding.patch));

      if (action === "abort") {
        await tryWriteAudit({
          eventType: "finding_blocked",
          finding,
          action: "blocked",
          createdAt: new Date(),
        });
        clack.outro(chalk.red("Push aborted."));
        process.exitCode = 1;
        return;
      }

      if (action === "view-details") {
        console.log(chalk.bold("\nEvidence:"));
        console.log(chalk.dim(finding.evidence));
        console.log("");
        process.exitCode = 1;
        return;
      }

      if (action === "apply-patch") {
        const hunk = hunks.find((h) => h.file === finding.file);
        let patch = finding.patch;

        if (!patch && hunk) {
          const spinner = clack.spinner();
          spinner.start("Generating patch with AI...");
          patch = (await tryGeneratePatch(finding, hunk)) ?? undefined;
          spinner.stop(patch ? "Patch generated." : "Could not generate patch automatically.");
        }

        if (!patch) {
          console.log(chalk.yellow("\nNo patch available. Manual fix required:"));
          console.log(finding.recommendation);
          process.exitCode = 1;
          return;
        }

        console.log(chalk.bold("\nSuggested patch:"));
        console.log(chalk.green(patch));
        console.log("");

        const confirmed = await clack.confirm({ message: "Apply this patch to the file?" });
        if (clack.isCancel(confirmed) || !confirmed) {
          process.exitCode = 1;
          return;
        }

        await applyPatch(finding.file, finding.evidence, patch);
        await tryWriteAudit({
          eventType: "patch_applied",
          finding,
          action: "patched",
          createdAt: new Date(),
        });

        clack.outro(
          chalk.green("Patch applied. Review the change, stage it, commit, and push again.")
        );
        process.exitCode = 1;
        return;
      }

      if (action === "override") {
        const reason = await promptOverrideReason();
        if (!reason) {
          clack.outro(chalk.red("Override cancelled."));
          process.exitCode = 1;
          return;
        }

        const override = await tryOverride(finding, reason, commitSha);

        if (!override.success) {
          clack.outro(chalk.red("Authentication failed. Override cancelled."));
          process.exitCode = 1;
          return;
        }

        await tryWriteAudit({
          eventType: "override_approved",
          finding,
          overrideReason: reason,
          userEmail: override.userEmail,
          jwtClaims: override.claims,
          action: "overridden",
          createdAt: new Date(),
        });

        clack.outro(
          chalk.green(
            `Override approved. Authenticated as ${override.userEmail ?? "unknown"}. Push allowed.`
          )
        );
        process.exitCode = 0;
        return;
      }
    }
  } catch (err) {
    // Hook must never crash unhandled — log and exit 1 to block push safely
    console.error(chalk.red("\n[custos] Unexpected error:"), (err as Error).message);
    process.exitCode = 1;
  }
}

async function applyPatch(file: string, evidence: string, patch: string): Promise<void> {
  const content = await fs.readFile(file, "utf8");
  const evidenceTrimmed = evidence.trim();

  if (!content.includes(evidenceTrimmed)) {
    throw new Error(`Could not locate evidence in ${file}. Manual patch required.`);
  }

  const updated = content.replace(evidenceTrimmed, patch.trim());
  await fs.writeFile(file, updated, "utf8");
}
```

- [ ] **Step 2: Verify scan runs without crashing on a clean repo**

```bash
custos scan
```

Expected: "No changes to scan." or a list of findings if the repo has uncommitted changes. Does not throw.

- [ ] **Step 3: Commit**

```bash
git add src/commands/scan.ts
git commit -m "feat: implement custos scan core loop"
```

---

## Phase 2 — Integrations

---

### Task 5: MongoDB Audit Logging

**Files:**
- Modify: `src/audit/mongo.ts` (replace stub)
- Modify: `src/audit/writeAudit.ts` (replace stub)
- Create: `test/audit/writeAudit.test.ts`

**Interfaces:**
- `src/audit/model.ts` already has `auditEventSchema` — register the Mongoose model here in mongo.ts
- Consumes: `AuditEvent` from `src/scanner/types.ts`; `auditEventSchema` from `src/audit/model.ts`
- Produces:
  - `connectMongo(): Promise<Connection>` — connects; warns and returns a disconnected Connection on failure
  - `disconnectMongo(): Promise<void>`
  - `writeAuditEvent(event: AuditEvent): Promise<void>` — no-op if not connected
  - `listAuditEvents(limit?: number): Promise<AuditEvent[]>` — returns `[]` if not connected

- [ ] **Step 1: Write the failing test**

`test/audit/writeAudit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildAuditEventBase } from "../../src/audit/writeAudit.js";
import type { Finding } from "../../src/scanner/types.js";

const finding: Finding = {
  id: "abc12345",
  severity: "critical",
  category: "secret",
  title: "Hardcoded API key",
  file: "src/server.ts",
  line: 12,
  evidence: 'const KEY = "sk-abc";',
  explanation: "API key in source.",
  recommendation: "Use env var.",
  source: "rule",
};

describe("buildAuditEventBase", () => {
  it("includes the eventType and action", () => {
    const base = buildAuditEventBase({ eventType: "finding_blocked", finding, action: "blocked" });
    expect(base.eventType).toBe("finding_blocked");
    expect(base.action).toBe("blocked");
  });

  it("includes the finding", () => {
    const base = buildAuditEventBase({ eventType: "finding_blocked", finding, action: "blocked" });
    expect(base.finding?.id).toBe("abc12345");
  });

  it("hashes the repo path to 16 hex chars", () => {
    const base = buildAuditEventBase({ eventType: "scan_passed", action: "allowed" });
    expect(base.repoPathHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("sets createdAt to a Date", () => {
    const base = buildAuditEventBase({ eventType: "scan_passed", action: "allowed" });
    expect(base.createdAt).toBeInstanceOf(Date);
  });

  it("derives repoName from cwd", () => {
    const base = buildAuditEventBase({ eventType: "scan_passed", action: "allowed" });
    expect(typeof base.repoName).toBe("string");
    expect(base.repoName.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/audit/writeAudit.test.ts
```

Expected: FAIL — `Cannot find module '../../src/audit/writeAudit.js'` (or `buildAuditEventBase` not exported)

- [ ] **Step 3: Implement src/audit/mongo.ts**

```ts
import mongoose, { type Connection } from "mongoose";
import { auditEventSchema } from "./model.js";
import type { AuditEvent } from "../scanner/types.js";

let _connection: Connection | null = null;

export function getAuditModel() {
  if (!_connection) return null;
  // Register or retrieve the model on this connection
  try {
    return _connection.model<AuditEvent>("AuditEvent");
  } catch {
    return _connection.model<AuditEvent>("AuditEvent", auditEventSchema);
  }
}

export async function connectMongo(): Promise<Connection> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    // Return a disconnected dummy connection — callers check isConnected()
    return mongoose.createConnection();
  }

  try {
    const conn = mongoose.createConnection(uri, {
      dbName: process.env.MONGODB_DB ?? "custos",
      serverSelectionTimeoutMS: 5000,
    });
    await conn.asPromise();
    _connection = conn;
    return conn;
  } catch (err) {
    console.warn(
      `[custos] MongoDB unavailable — audit logging disabled: ${(err as Error).message}`
    );
    return mongoose.createConnection();
  }
}

export async function disconnectMongo(): Promise<void> {
  if (_connection) {
    await _connection.close();
    _connection = null;
  }
}

export function isConnected(): boolean {
  return _connection !== null && _connection.readyState === 1;
}
```

- [ ] **Step 4: Implement src/audit/writeAudit.ts**

```ts
import { createHash } from "crypto";
import { execa } from "execa";
import { getAuditModel, isConnected } from "./mongo.js";
import type { AuditEvent, AuditEventType, AuditAction, Finding } from "../scanner/types.js";

type AuditEventInput = {
  eventType: AuditEventType;
  finding?: Finding;
  overrideReason?: string;
  userId?: string;
  userEmail?: string;
  jwtClaims?: Record<string, unknown>;
  action: AuditAction;
};

export function buildAuditEventBase(
  input: AuditEventInput
): Omit<AuditEvent, "branch" | "commitSha"> {
  const cwd = process.cwd();
  const repoName = cwd.split("/").pop() ?? "unknown";
  const repoPathHash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);

  return {
    ...input,
    repoName,
    repoPathHash,
    createdAt: new Date(),
  };
}

export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  if (!isConnected()) return;
  const model = getAuditModel();
  if (!model) return;

  let branch: string | undefined;
  let commitSha: string | undefined;
  try {
    branch = (await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    commitSha = (await execa("git", ["rev-parse", "HEAD"])).stdout.trim().slice(0, 7);
  } catch {}

  await model.create({ ...event, branch, commitSha });
}

export async function listAuditEvents(limit = 20): Promise<AuditEvent[]> {
  if (!isConnected()) return [];
  const model = getAuditModel();
  if (!model) return [];
  return model.find().sort({ createdAt: -1 }).limit(limit).lean() as Promise<AuditEvent[]>;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- test/audit/writeAudit.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/audit/mongo.ts src/audit/writeAudit.ts test/audit/writeAudit.test.ts
git commit -m "feat: implement MongoDB audit logging"
```

---

### Task 6: Auth0 Device Flow and Claims Builder

**Files:**
- Modify: `src/auth/claimsBuilder.ts` (replace stub)
- Modify: `src/auth/deviceFlow.ts` (replace stub)
- Create: `test/auth/claimsBuilder.test.ts`
- Auth0 Dashboard: create post-login Action (manual step — instructions in Step 6)

**Interfaces:**
- Produces:
  - `buildFindingContext(finding, commitSha, overrideReason): FindingContext`
  - `requestDeviceCode(findingContext: FindingContext): Promise<DeviceCodeResponse>`
  - `pollForToken(deviceCode: string, interval: number): Promise<DeviceFlowResult>`

- [ ] **Step 1: Write the failing test**

`test/auth/claimsBuilder.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildFindingContext } from "../../src/auth/claimsBuilder.js";
import type { Finding } from "../../src/scanner/types.js";

const finding: Finding = {
  id: "abc12345",
  severity: "critical",
  category: "secret",
  title: "Hardcoded API key",
  file: "src/server.ts",
  line: 12,
  evidence: 'const KEY = "sk-abc";',
  explanation: "Exposed key.",
  recommendation: "Use env var.",
  source: "rule",
};

describe("buildFindingContext", () => {
  it("sets finding_id under the custos namespace", () => {
    const ctx = buildFindingContext(finding, undefined, "deadline");
    expect(ctx["https://custos/finding_id"]).toBe("abc12345");
  });

  it("sets severity", () => {
    const ctx = buildFindingContext(finding, undefined, "deadline");
    expect(ctx["https://custos/severity"]).toBe("critical");
  });

  it("sets override_reason", () => {
    const ctx = buildFindingContext(finding, undefined, "key already rotated");
    expect(ctx["https://custos/override_reason"]).toBe("key already rotated");
  });

  it("sets commit_sha when provided", () => {
    const ctx = buildFindingContext(finding, "a3f9c1", "reason");
    expect(ctx["https://custos/commit_sha"]).toBe("a3f9c1");
  });

  it("sets line when present on finding", () => {
    const ctx = buildFindingContext(finding, undefined, "reason");
    expect(ctx["https://custos/line"]).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/auth/claimsBuilder.test.ts
```

Expected: FAIL — `buildFindingContext: not implemented`

- [ ] **Step 3: Implement src/auth/claimsBuilder.ts**

```ts
import type { Finding } from "../scanner/types.js";

export type FindingContext = {
  "https://custos/finding_id": string;
  "https://custos/severity": string;
  "https://custos/rule": string;
  "https://custos/file": string;
  "https://custos/line"?: number;
  "https://custos/commit_sha"?: string;
  "https://custos/override_reason": string;
};

export function buildFindingContext(
  finding: Finding,
  commitSha: string | undefined,
  overrideReason: string
): FindingContext {
  return {
    "https://custos/finding_id": finding.id,
    "https://custos/severity": finding.severity,
    "https://custos/rule": finding.category,
    "https://custos/file": finding.file,
    ...(finding.line !== undefined ? { "https://custos/line": finding.line } : {}),
    ...(commitSha !== undefined ? { "https://custos/commit_sha": commitSha } : {}),
    "https://custos/override_reason": overrideReason,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/auth/claimsBuilder.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Implement src/auth/deviceFlow.ts**

```ts
import type { FindingContext } from "./claimsBuilder.js";

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type DeviceFlowResult = {
  accessToken: string;
  claims: Record<string, unknown>;
};

type TokenPollResponse =
  | { error: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" }
  | { access_token: string; id_token?: string; token_type: string };

export async function requestDeviceCode(
  findingContext: FindingContext
): Promise<DeviceCodeResponse> {
  const domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;
  const audience = process.env.AUTH0_AUDIENCE;

  if (!domain || !clientId) {
    throw new Error("Auth0 not configured. Set AUTH0_DOMAIN and AUTH0_CLIENT_ID.");
  }

  // Pass finding context as custom params so the post-login Action can
  // embed them as JWT claims. Auth0 forwards unknown params to Actions
  // via event.transaction.params.
  const body = new URLSearchParams({
    client_id: clientId,
    scope: "openid email profile",
    ...(audience ? { audience } : {}),
    custos_finding_id: findingContext["https://custos/finding_id"],
    custos_severity: findingContext["https://custos/severity"],
    custos_file: findingContext["https://custos/file"],
    custos_rule: findingContext["https://custos/rule"],
  });

  const res = await fetch(`https://${domain}/oauth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Auth0 device code request failed: ${res.status}`);
  }

  return res.json() as Promise<DeviceCodeResponse>;
}

export async function pollForToken(
  deviceCode: string,
  interval: number
): Promise<DeviceFlowResult> {
  const domain = process.env.AUTH0_DOMAIN;
  const clientId = process.env.AUTH0_CLIENT_ID;

  if (!domain || !clientId) {
    throw new Error("Auth0 not configured.");
  }

  let pollMs = interval * 1000;
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minute hard cap

  while (Date.now() < expiresAt) {
    await sleep(pollMs);

    const res = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: clientId,
      }),
    });

    const data = (await res.json()) as TokenPollResponse;

    if ("error" in data) {
      if (data.error === "authorization_pending") continue;
      if (data.error === "slow_down") { pollMs += 5000; continue; }
      if (data.error === "expired_token") throw new Error("Verification expired.");
      throw new Error(`Auth0 error: ${data.error}`);
    }

    // Success — decode JWT payload for claims
    const accessClaims = decodeJwtPayload(data.access_token);
    const idClaims = data.id_token ? decodeJwtPayload(data.id_token) : {};

    return {
      accessToken: data.access_token,
      claims: { ...idClaims, ...accessClaims },
    };
  }

  throw new Error("Verification timed out after 5 minutes.");
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 6: Set up Auth0 post-login Action (manual — do this in the Auth0 Dashboard)**

This Action embeds the finding context into the JWT so the token itself is a signed record of the security decision that was overridden.

1. Go to **Auth0 Dashboard → Actions → Library → Create Action**
2. Name: `Custos Finding Claims`
3. Trigger: **Login / Post Login**
4. Paste this code and deploy:

```js
exports.onExecutePostLogin = async (event, api) => {
  const NS = "https://custos";
  const params = event.transaction?.params ?? {};

  if (params.custos_finding_id) {
    api.accessToken.setCustomClaim(`${NS}/finding_id`, params.custos_finding_id);
    api.accessToken.setCustomClaim(`${NS}/severity`,   params.custos_severity ?? "");
    api.accessToken.setCustomClaim(`${NS}/file`,       params.custos_file ?? "");
    api.accessToken.setCustomClaim(`${NS}/rule`,       params.custos_rule ?? "");
  }
};
```

5. Go to **Actions → Flows → Login** and drag `Custos Finding Claims` into the flow between Start and Complete.

- [ ] **Step 7: Commit**

```bash
git add src/auth/claimsBuilder.ts src/auth/deviceFlow.ts test/auth/claimsBuilder.test.ts
git commit -m "feat: implement Auth0 Device Flow and finding claims builder"
```

---

### Task 7: Backboard AI Client

**Files:**
- Modify: `src/ai/backboardClient.ts` (replace stub)

`src/ai/prompts.ts` is human-owned — leave as-is. The client calls into it; if the human hasn't implemented it yet, the client will catch the thrown error and fall back gracefully.

**Interfaces:**
- Consumes: `ExplainResponse`, `PatchResponse` from `src/ai/schemas.ts`; `getExplainModel`, `getPatchModel`, `buildExplainPrompt`, `buildPatchPrompt`, `BackboardPromptContext` from `src/ai/prompts.ts`
- Produces:
  - `explainFinding(finding: Finding, hunk: DiffHunk): Promise<ExplainResponse>`
  - `generatePatch(finding: Finding, hunk: DiffHunk): Promise<PatchResponse>`

- [ ] **Step 1: Implement src/ai/backboardClient.ts**

```ts
import type { DiffHunk, Finding } from "../scanner/types.js";
import { explainResponseSchema, patchResponseSchema } from "./schemas.js";
import type { ExplainResponse, PatchResponse } from "./schemas.js";

const BASE_URL = process.env.BACKBOARD_BASE_URL ?? "https://app.backboard.io/api";

async function callBackboard(
  content: string,
  provider: string,
  model: string
): Promise<string | null> {
  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${BASE_URL}/threads/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        content,
        llm_provider: provider,
        model_name: model,
        system_prompt: content,
        json_output: true,
      }),
    });

    if (!res.ok) {
      console.warn(`[custos] Backboard returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { content: string };
    return data.content;
  } catch (err) {
    console.warn(`[custos] Backboard request failed: ${(err as Error).message}`);
    return null;
  }
}

export async function explainFinding(
  finding: Finding,
  hunk: DiffHunk
): Promise<ExplainResponse> {
  const { getExplainModel, buildExplainPrompt } = await import("./prompts.js");
  const { llm_provider, model_name } = getExplainModel();
  const ruleName = finding.category;
  const prompt = buildExplainPrompt({ finding, hunk, ruleName });

  const raw = await callBackboard(prompt, llm_provider, model_name);
  if (!raw) throw new Error("Backboard explain call returned no content");

  return explainResponseSchema.parse(JSON.parse(raw));
}

export async function generatePatch(
  finding: Finding,
  hunk: DiffHunk
): Promise<PatchResponse> {
  const { getPatchModel, buildPatchPrompt } = await import("./prompts.js");
  const { llm_provider, model_name } = getPatchModel();
  const ruleName = finding.category;
  const prompt = buildPatchPrompt({ finding, hunk, ruleName });

  const raw = await callBackboard(prompt, llm_provider, model_name);
  if (!raw) throw new Error("Backboard patch call returned no content");

  return patchResponseSchema.parse(JSON.parse(raw));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ai/backboardClient.ts
git commit -m "feat: implement Backboard AI client — explain and patch calls"
```

---

### Task 8: custos doctor and custos audit

**Files:**
- Modify: `src/commands/doctor.ts` (replace stub)
- Modify: `src/commands/audit.ts` (replace stub)

**Interfaces:**
- Consumes: `connectMongo`, `disconnectMongo`, `isConnected` from `src/audit/mongo.ts`; `listAuditEvents` from `src/audit/writeAudit.ts`; `severityColor` from `src/ui/theme.ts`
- Produces: `runDoctor(): Promise<void>`, `runAudit(): Promise<void>`

- [ ] **Step 1: Implement src/commands/doctor.ts**

```ts
import { execa } from "execa";
import chalk from "chalk";
import mongoose from "mongoose";

type Check = { label: string; pass: boolean; detail: string };

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // Node.js version
  const major = parseInt(process.version.slice(1).split(".")[0]!);
  checks.push({
    label: "Node.js >= 18",
    pass: major >= 18,
    detail: process.version,
  });

  // Git
  try {
    const { stdout } = await execa("git", ["--version"]);
    checks.push({ label: "Git", pass: true, detail: stdout.trim() });
  } catch {
    checks.push({ label: "Git", pass: false, detail: "not found in PATH" });
  }

  // Backboard
  const hasBackboard = Boolean(process.env.BACKBOARD_API_KEY);
  checks.push({
    label: "Backboard API key",
    pass: hasBackboard,
    detail: hasBackboard ? "configured" : "BACKBOARD_API_KEY not set (AI enrichment disabled)",
  });

  // Auth0
  const auth0Vars = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID"];
  const missingAuth0 = auth0Vars.filter((v) => !process.env[v]);
  checks.push({
    label: "Auth0 config",
    pass: missingAuth0.length === 0,
    detail:
      missingAuth0.length === 0
        ? `domain: ${process.env.AUTH0_DOMAIN}`
        : `Missing: ${missingAuth0.join(", ")}`,
  });

  // MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    checks.push({ label: "MongoDB", pass: false, detail: "MONGODB_URI not set" });
  } else {
    try {
      const conn = mongoose.createConnection(mongoUri, {
        dbName: process.env.MONGODB_DB ?? "custos",
        serverSelectionTimeoutMS: 3000,
      });
      await conn.asPromise();
      await conn.close();
      checks.push({ label: "MongoDB", pass: true, detail: "connected successfully" });
    } catch (err) {
      checks.push({ label: "MongoDB", pass: false, detail: (err as Error).message });
    }
  }

  return checks;
}

export async function runDoctor(): Promise<void> {
  console.log(chalk.bold("\nCustos Doctor\n"));
  const checks = await runChecks();

  for (const check of checks) {
    const icon = check.pass ? chalk.green("✓") : chalk.red("✗");
    const label = chalk.bold(check.label.padEnd(22));
    console.log(`  ${icon}  ${label} ${chalk.dim(check.detail)}`);
  }

  console.log("");
  const failed = checks.filter((c) => !c.pass);
  if (failed.length === 0) {
    console.log(chalk.green("  All checks passed. Ready to demo.\n"));
  } else {
    console.log(
      chalk.yellow(`  ${failed.length} check(s) need attention: ${failed.map((c) => c.label).join(", ")}\n`)
    );
  }
}
```

- [ ] **Step 2: Implement src/commands/audit.ts**

```ts
import chalk from "chalk";
import { connectMongo } from "../audit/mongo.js";
import { listAuditEvents } from "../audit/writeAudit.js";
import { severityColor } from "../ui/theme.js";
import type { Severity } from "../scanner/types.js";

export async function runAudit(): Promise<void> {
  const conn = await connectMongo();
  if (conn.readyState !== 1) {
    console.error(chalk.red("MongoDB not configured or unavailable. Set MONGODB_URI."));
    process.exitCode = 1;
    return;
  }

  const events = await listAuditEvents(20);

  if (events.length === 0) {
    console.log(chalk.dim("\nNo audit events found.\n"));
    return;
  }

  console.log(chalk.bold("\nRecent Custos Events\n"));

  for (const event of events) {
    const time = new Date(event.createdAt).toLocaleString();
    const sev = event.finding?.severity as Severity | undefined;
    const badge = sev
      ? severityColor[sev](` ${sev.toUpperCase()} `) + "  "
      : "";

    console.log(`${badge}${chalk.bold(event.finding?.title ?? event.eventType)}`);
    console.log(`  ${chalk.dim("Repo:")}    ${event.repoName}`);
    if (event.branch) console.log(`  ${chalk.dim("Branch:")}  ${event.branch}`);
    if (event.commitSha) console.log(`  ${chalk.dim("Commit:")}  ${event.commitSha}`);
    if (event.userEmail) console.log(`  ${chalk.dim("User:")}    ${event.userEmail}`);
    console.log(`  ${chalk.dim("Action:")}  ${event.action}`);
    if (event.overrideReason) console.log(`  ${chalk.dim("Reason:")}  ${event.overrideReason}`);
    if (event.jwtClaims?.["https://custos/finding_id"]) {
      console.log(`  ${chalk.dim("JWT:")}     ${chalk.green("finding context embedded ✓")}`);
    }
    console.log(`  ${chalk.dim("Time:")}    ${time}`);
    console.log("");
  }
}
```

- [ ] **Step 3: Verify doctor manually**

```bash
custos doctor
```

Expected: pass/fail table for Node, Git, Backboard, Auth0, MongoDB. Missing env vars show ✗.

- [ ] **Step 4: Commit**

```bash
git add src/commands/doctor.ts src/commands/audit.ts
git commit -m "feat: implement custos doctor and custos audit"
```

---

### Task 9: Demo Fixtures

**Files:**
- Create: `demo/vulnerable.ts` — primary demo: hardcoded secret
- Create: `demo/secondary.ts` — secondary demo: SQL injection
- Create: `demo/README.md` — live demo instructions

- [ ] **Step 1: Create demo/vulnerable.ts**

```ts
import express from "express";

const app = express();

// Hardcoded secret — Custos should detect and block this push
const OPENAI_API_KEY = "sk-demo-leaked-key-do-not-commit";

app.get("/summarize", async (req, res) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: String(req.query["text"]) }],
    }),
  });
  res.json(await response.json());
});

app.listen(3000);
```

- [ ] **Step 2: Create demo/secondary.ts**

```ts
import express from "express";

const app = express();

// SQL injection via string concatenation — Custos should detect and block this
app.get("/user", async (req, res) => {
  const { createConnection } = await import("mysql2/promise");
  const db = await createConnection(process.env["DATABASE_URL"]!);
  const user = await db.query(
    "SELECT * FROM users WHERE id = " + req.query["id"]
  );
  res.json(user);
});

app.listen(3001);
```

- [ ] **Step 3: Create demo/README.md**

```markdown
# Custos Live Demo Script

## Setup

1. Run `custos init` in this repo.
2. Ensure a git remote exists: `git remote add origin <url>`.
3. Run `custos doctor` — confirm all checks pass.

## Primary Demo: Hardcoded Secret (blocked → patched)

```bash
git add demo/vulnerable.ts
git commit -m "add payment workflow"
git push
```

Custos intercepts → shows CRITICAL finding → offer "Apply suggested patch" → file updated → recommit → push passes.

## Override Demo: SQL Injection (blocked → override)

```bash
git add demo/secondary.ts
git commit -m "add user lookup endpoint"
git push
```

Custos intercepts → shows CRITICAL SQL injection → choose "Force override with Auth0" → verify in browser → push allowed.

Run `custos audit` to show the event with Auth0 JWT claims embedded in the record.

## Closing line

> "Custos does not remove developer judgment. It makes risky judgment visible, authenticated, and auditable — and Auth0 signs every decision."
```

- [ ] **Step 4: Commit**

```bash
git add demo/
git commit -m "feat: add demo fixtures for live demo"
```

---

## Final Verification

- [ ] Run the full test suite:

```bash
npm test
```

Expected: all tests pass.

- [ ] Type-check the project:

```bash
npm run typecheck
```

Expected: no errors.

- [ ] Build:

```bash
npm run build
```

Expected: `dist/` populated, no errors.

- [ ] Run `custos doctor` with all env vars set:

```bash
custos doctor
```

Expected: all five checks show ✓.

- [ ] Run the full manual demo flow from `demo/README.md`.
```
