import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { Finding } from "../../src/scanner/types.js";

vi.mock("../../src/git/getDiff.js", () => ({
  getDiff: vi.fn(),
}));

vi.mock("../../src/scanner/scanDiff.js", () => ({
  scanDiff: vi.fn(),
}));

vi.mock("../../src/ui/prompts.js", () => ({
  promptFindingAction: vi.fn(),
  promptConfirm: vi.fn(),
  promptOverrideReason: vi.fn(),
}));

vi.mock("../../src/ui/renderFinding.js", () => ({
  renderFinding: vi.fn(),
}));

vi.mock("../../src/audit/writeAudit.js", () => ({
  writeAuditEvent: vi.fn(async () => {}),
  listAuditEvents: vi.fn(async () => []),
}));

vi.mock("../../src/auth/claimsBuilder.js", () => ({
  buildFindingContext: vi.fn(() => ({})),
}));

vi.mock("../../src/auth/deviceFlow.js", () => ({
  requestDeviceCode: vi.fn(async () => ({
    device_code: "device-1",
    user_code: "ABCD-EFGH",
    verification_uri: "https://example.com/activate",
    expires_in: 300,
    interval: 1,
  })),
  pollForToken: vi.fn(),
}));

vi.mock("open", () => ({
  default: vi.fn(async () => {}),
}));

vi.mock("../../src/commands/repoState.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/commands/repoState.js")>(
    "../../src/commands/repoState.js",
  );
  return {
    ...actual,
    resolveRepoState: vi.fn(),
    readRepoConfig: vi.fn(async () => null),
  };
});

const { getDiff } = await import("../../src/git/getDiff.js");
const { scanDiff } = await import("../../src/scanner/scanDiff.js");
const { promptFindingAction, promptConfirm, promptOverrideReason } = await import("../../src/ui/prompts.js");
const { writeAuditEvent } = await import("../../src/audit/writeAudit.js");
const { pollForToken, requestDeviceCode } = await import("../../src/auth/deviceFlow.js");
const { resolveRepoState } = await import("../../src/commands/repoState.js");
const { runScan } = await import("../../src/commands/scan.js");

const SAMPLE_DIFF = `diff --git a/src/server.ts b/src/server.ts
index abc1234..def5678 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -1,2 +1,3 @@
 import express from 'express';
+const OPENAI_API_KEY = "sk-demo-leaked-key";
`;

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "abc12345",
    severity: "critical",
    category: "secret",
    title: "Hardcoded API key detected",
    file: "vulnerable.ts",
    line: 1,
    evidence: 'const OPENAI_API_KEY = "sk-demo-leaked-key";',
    explanation: "This API key will be exposed in the remote repository.",
    recommendation: "Move the secret to process.env.OPENAI_API_KEY.",
    source: "rule",
    ...overrides,
  };
}

let tmpDir: string;
let originalStdin: NodeJS.ReadStream;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "custos-scan-test-"));
  originalStdin = process.stdin;
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: { isTTY: true },
  });

  process.exitCode = undefined;
  vi.mocked(resolveRepoState).mockResolvedValue({
    repoRoot: tmpDir,
    gitCommonDir: path.join(tmpDir, ".git"),
    configPath: path.join(tmpDir, ".custos", "config.json"),
    hookPath: path.join(tmpDir, ".git", "hooks", "pre-push"),
  });

  vi.mocked(requestDeviceCode).mockResolvedValue({
    device_code: "device-1",
    user_code: "ABCD-EFGH",
    verification_uri: "https://example.com/activate",
    expires_in: 300,
    interval: 1,
  });

  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
  process.exitCode = undefined;
  vi.resetAllMocks();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("runScan — no findings / warnings", () => {
  it("exits 0 with no changes to scan", async () => {
    vi.mocked(getDiff).mockResolvedValue("");

    await runScan({});

    expect(process.exitCode).toBe(0);
  });

  it("exits 0 when no findings are detected", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([]);

    await runScan({});

    expect(process.exitCode).toBe(0);
  });

  it("allows the push when only warning-level (medium) findings exist", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding({ severity: "medium" })]);

    await runScan({});

    expect(process.exitCode).toBe(0);
    expect(promptFindingAction).not.toHaveBeenCalled();
  });

  it("--json emits findings and blocks (exit 1) when a blocking finding exists", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding({ severity: "critical" })]);

    await runScan({ json: true });

    expect(process.exitCode).toBe(1);
    const printed = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(printed).toContain("Hardcoded API key detected");
  });
});

describe("runScan — blocking finding action menu", () => {
  it("blocks the push when the user aborts", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("abort");

    await runScan({});

    expect(process.exitCode).toBe(1);
    expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "finding_blocked" }));
  });

  it("blocks the push and shows evidence when the user views details", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("view-details");

    await runScan({});

    expect(process.exitCode).toBe(1);
  });
});

describe("runScan — apply patch", () => {
  async function writeVulnerableFile(): Promise<void> {
    await fs.writeFile(path.join(tmpDir, "vulnerable.ts"), 'const OPENAI_API_KEY = "sk-demo-leaked-key";\n');
  }

  it("applies a provided patch, writes the file, and always exits 1", async () => {
    await writeVulnerableFile();
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([
      makeFinding({ patch: "const OPENAI_API_KEY = process.env.OPENAI_API_KEY;" }),
    ]);
    vi.mocked(promptFindingAction).mockResolvedValue("apply-patch");
    vi.mocked(promptConfirm).mockResolvedValue(true);

    await runScan({});

    expect(process.exitCode).toBe(1);
    const content = await fs.readFile(path.join(tmpDir, "vulnerable.ts"), "utf8");
    expect(content).toContain("process.env.OPENAI_API_KEY");
    expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "patch_applied" }));
  });

  it("does not modify the file when the user rejects the patch preview", async () => {
    await writeVulnerableFile();
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([
      makeFinding({ patch: "const OPENAI_API_KEY = process.env.OPENAI_API_KEY;" }),
    ]);
    vi.mocked(promptFindingAction).mockResolvedValue("apply-patch");
    vi.mocked(promptConfirm).mockResolvedValue(false);

    await runScan({});

    expect(process.exitCode).toBe(1);
    const content = await fs.readFile(path.join(tmpDir, "vulnerable.ts"), "utf8");
    expect(content).toContain("sk-demo-leaked-key");
  });

  it("blocks with manual guidance when the evidence can't be located in the file", async () => {
    await writeVulnerableFile();
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([
      makeFinding({
        evidence: "this text does not appear in the file",
        patch: "const OPENAI_API_KEY = process.env.OPENAI_API_KEY;",
      }),
    ]);
    vi.mocked(promptFindingAction).mockResolvedValue("apply-patch");
    vi.mocked(promptConfirm).mockResolvedValue(true);

    await runScan({});

    expect(process.exitCode).toBe(1);
    const content = await fs.readFile(path.join(tmpDir, "vulnerable.ts"), "utf8");
    expect(content).toContain("sk-demo-leaked-key");
  });

  it("blocks with a manual-fix message when no patch can be generated", async () => {
    await writeVulnerableFile();
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("apply-patch");

    await runScan({});

    expect(process.exitCode).toBe(1);
    expect(promptConfirm).not.toHaveBeenCalled();
  });
});

describe("runScan — Auth0 override", () => {
  it("allows the push when the override succeeds and the audit write succeeds", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("override");
    vi.mocked(promptOverrideReason).mockResolvedValue("hotfix, key already rotated");
    vi.mocked(pollForToken).mockResolvedValue({
      accessToken: "token",
      claims: { email: "dev@example.com" },
    });

    await runScan({});

    expect(process.exitCode).toBe(0);
    expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "override_approved" }));
  });

  it("blocks the push when the device flow is denied/expired", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("override");
    vi.mocked(promptOverrideReason).mockResolvedValue("hotfix");
    vi.mocked(pollForToken).mockRejectedValue(new Error("expired_token"));

    await runScan({});

    expect(process.exitCode).toBe(1);
    expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "override_denied" }));
  });

  it("blocks the push when the audit write fails and the user declines to continue unlogged", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("override");
    vi.mocked(promptOverrideReason).mockResolvedValue("hotfix");
    vi.mocked(pollForToken).mockResolvedValue({ accessToken: "token", claims: {} });
    vi.mocked(writeAuditEvent).mockRejectedValue(new Error("Mongo unavailable"));
    vi.mocked(promptConfirm).mockResolvedValue(false);

    await runScan({});

    expect(process.exitCode).toBe(1);
    expect(promptConfirm).toHaveBeenCalledWith(expect.stringContaining("will not be logged"), false);
  });

  it("allows the push when the audit write fails but the user confirms continuing unlogged", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("override");
    vi.mocked(promptOverrideReason).mockResolvedValue("hotfix");
    vi.mocked(pollForToken).mockResolvedValue({ accessToken: "token", claims: {} });
    vi.mocked(writeAuditEvent).mockRejectedValue(new Error("Mongo unavailable"));
    vi.mocked(promptConfirm).mockResolvedValue(true);

    await runScan({});

    expect(process.exitCode).toBe(0);
  });
});

describe("runScan — non-interactive fallback", () => {
  it("blocks without prompting when no interactive TTY is available", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);

    const fakeStdin = new Readable({
      read() {
        this.push(null);
      },
    });
    Object.defineProperty(fakeStdin, "isTTY", { value: false });
    Object.defineProperty(process, "stdin", { configurable: true, value: fakeStdin });
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });

    try {
      await runScan({ prePush: true });
    } finally {
      Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
    }

    expect(process.exitCode).toBe(1);
    expect(promptFindingAction).not.toHaveBeenCalled();
  });
});
