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
  promptIssueSelection: vi.fn(),
  promptConfirm: vi.fn(),
  promptOverrideReason: vi.fn(),
  promptReturnToActions: vi.fn(async () => {}),
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
const { promptFindingAction, promptIssueSelection, promptConfirm, promptOverrideReason, promptReturnToActions } = await import("../../src/ui/prompts.js");
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
let originalPrePushStdinFile: string | undefined;
let originalAllowOverride: string | undefined;
let originalAuth0Domain: string | undefined;
let originalAuth0ClientId: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "custos-scan-test-"));
  originalStdin = process.stdin;
  originalPrePushStdinFile = process.env.CUSTOS_PRE_PUSH_STDIN_FILE;
  originalAllowOverride = process.env.CUSTOS_ALLOW_OVERRIDE;
  originalAuth0Domain = process.env.AUTH0_DOMAIN;
  originalAuth0ClientId = process.env.AUTH0_CLIENT_ID;
  delete process.env.CUSTOS_PRE_PUSH_STDIN_FILE;
  delete process.env.CUSTOS_ALLOW_OVERRIDE;
  delete process.env.AUTH0_DOMAIN;
  delete process.env.AUTH0_CLIENT_ID;
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
  if (originalPrePushStdinFile === undefined) {
    delete process.env.CUSTOS_PRE_PUSH_STDIN_FILE;
  } else {
    process.env.CUSTOS_PRE_PUSH_STDIN_FILE = originalPrePushStdinFile;
  }
  if (originalAllowOverride === undefined) {
    delete process.env.CUSTOS_ALLOW_OVERRIDE;
  } else {
    process.env.CUSTOS_ALLOW_OVERRIDE = originalAllowOverride;
  }
  if (originalAuth0Domain === undefined) {
    delete process.env.AUTH0_DOMAIN;
  } else {
    process.env.AUTH0_DOMAIN = originalAuth0Domain;
  }
  if (originalAuth0ClientId === undefined) {
    delete process.env.AUTH0_CLIENT_ID;
  } else {
    process.env.AUTH0_CLIENT_ID = originalAuth0ClientId;
  }
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

  it("reads pre-push ref lines from the hook temp file when present", async () => {
    const refs = "refs/heads/main local-sha refs/heads/main remote-sha\n";
    const stdinFile = path.join(tmpDir, "pre-push-stdin.txt");
    await fs.writeFile(stdinFile, refs, "utf8");
    process.env.CUSTOS_PRE_PUSH_STDIN_FILE = stdinFile;
    vi.mocked(getDiff).mockResolvedValue("");

    await runScan({ prePush: true });

    expect(process.exitCode).toBe(0);
    expect(getDiff).toHaveBeenCalledWith(refs);
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
    expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "finding_detected", action: "allowed" }));
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
    expect(promptFindingAction).toHaveBeenCalledWith({ hasPatch: false, mode: "manual", allowOverride: false });
    expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "finding_blocked" }));
  });

  it("uses pre-push action labels when scanning from a hook", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding({ patch: "const value = process.env.VALUE;" })]);
    vi.mocked(promptFindingAction).mockResolvedValue("abort");

    await runScan({ prePush: true });

    expect(process.exitCode).toBe(1);
    expect(promptFindingAction).toHaveBeenCalledWith({ hasPatch: true, mode: "pre-push", allowOverride: false });
  });

  it("returns to the action menu after viewing technical details", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValueOnce("view-details").mockResolvedValueOnce("abort");

    await runScan({});

    expect(process.exitCode).toBe(1);
    expect(promptReturnToActions).toHaveBeenCalled();
    expect(promptFindingAction).toHaveBeenCalledTimes(2);
    expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "finding_blocked" }));
  });

  it("lets the user select which issue to analyze before applying a patch", async () => {
    const firstFinding = makeFinding({
      file: "first.ts",
      evidence: 'const OPENAI_API_KEY = "sk-demo-leaked-key";',
      patch: "const OPENAI_API_KEY = process.env.OPENAI_API_KEY;",
    });
    const secondFinding = makeFinding({
      id: "hardcoded-secret",
      title: "Hardcoded credential detected",
      file: "second.ts",
      evidence: 'const password = "hunter2";',
      patch: "const password = process.env.PASSWORD;",
    });
    await fs.writeFile(path.join(tmpDir, "first.ts"), `${firstFinding.evidence}\n`);
    await fs.writeFile(path.join(tmpDir, "second.ts"), `${secondFinding.evidence}\n`);
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([firstFinding, secondFinding]);
    vi.mocked(promptIssueSelection).mockResolvedValue(1);
    vi.mocked(promptFindingAction).mockResolvedValue("apply-patch");
    vi.mocked(promptConfirm).mockResolvedValue(true);

    await runScan({});

    expect(promptIssueSelection).toHaveBeenCalledWith([firstFinding, secondFinding], { mode: "manual" });
    expect(promptFindingAction).toHaveBeenCalledWith({
      hasPatch: true,
      mode: "manual",
      allowOverride: false,
      showBack: true,
    });
    await expect(fs.readFile(path.join(tmpDir, "first.ts"), "utf8")).resolves.toContain("sk-demo-leaked-key");
    await expect(fs.readFile(path.join(tmpDir, "second.ts"), "utf8")).resolves.toContain("process.env.PASSWORD");
    expect(process.exitCode).toBe(1);
  });

  it("returns from an issue action menu back to the issue list", async () => {
    const findings = [
      makeFinding({ file: "first.ts" }),
      makeFinding({ id: "dangerous-exec", title: "Command injection via child_process.exec", file: "second.ts" }),
    ];
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue(findings);
    vi.mocked(promptIssueSelection).mockResolvedValueOnce(0).mockResolvedValueOnce("abort");
    vi.mocked(promptFindingAction).mockResolvedValueOnce("back");

    await runScan({});

    expect(promptIssueSelection).toHaveBeenCalledTimes(2);
    expect(promptFindingAction).toHaveBeenCalledWith({
      hasPatch: false,
      mode: "manual",
      allowOverride: false,
      showBack: true,
    });
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

  it("returns to the action menu when the user rejects the patch preview", async () => {
    await writeVulnerableFile();
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([
      makeFinding({ patch: "const OPENAI_API_KEY = process.env.OPENAI_API_KEY;" }),
    ]);
    vi.mocked(promptFindingAction).mockResolvedValueOnce("apply-patch").mockResolvedValueOnce("abort");
    vi.mocked(promptConfirm).mockResolvedValue(false);

    await runScan({});

    expect(process.exitCode).toBe(1);
    expect(promptFindingAction).toHaveBeenCalledTimes(2);
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
  beforeEach(() => {
    process.env.CUSTOS_ALLOW_OVERRIDE = "true";
    process.env.AUTH0_DOMAIN = "example.auth0.com";
    process.env.AUTH0_CLIENT_ID = "client-id";
  });

  it("does not offer Auth0 override when override is disabled", async () => {
    delete process.env.CUSTOS_ALLOW_OVERRIDE;
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("abort");

    await runScan({});

    expect(promptFindingAction).toHaveBeenCalledWith({ hasPatch: false, mode: "manual", allowOverride: false });
    expect(process.exitCode).toBe(1);
  });

  it("hides Auth0 override during manual scan even when override is configured", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("abort");

    await runScan({});

    expect(promptFindingAction).toHaveBeenCalledWith({ hasPatch: false, mode: "manual", allowOverride: false });
    expect(process.exitCode).toBe(1);
  });

  it("allows env to enable Auth0 override during pre-push scans", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("abort");

    await runScan({ prePush: true });

    expect(promptFindingAction).toHaveBeenCalledWith({ hasPatch: false, mode: "pre-push", allowOverride: true });
    expect(process.exitCode).toBe(1);
  });

  it("allows the push when the override succeeds and the audit write succeeds", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("override");
    vi.mocked(promptOverrideReason).mockResolvedValue("hotfix, key already rotated");
    vi.mocked(pollForToken).mockResolvedValue({
      accessToken: "token",
      claims: { email: "dev@example.com" },
    });

    await runScan({ prePush: true });

    expect(process.exitCode).toBe(0);
    expect(writeAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "override_approved" }));
  });

  it("blocks the push when the device flow is denied/expired", async () => {
    vi.mocked(getDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(scanDiff).mockReturnValue([makeFinding()]);
    vi.mocked(promptFindingAction).mockResolvedValue("override");
    vi.mocked(promptOverrideReason).mockResolvedValue("hotfix");
    vi.mocked(pollForToken).mockRejectedValue(new Error("expired_token"));

    await runScan({ prePush: true });

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

    await runScan({ prePush: true });

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

    await runScan({ prePush: true });

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
