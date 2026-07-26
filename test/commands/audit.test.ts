import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "../../src/scanner/types.js";

vi.mock("../../src/audit/writeAudit.js", () => ({
  listAuditEvents: vi.fn(),
}));

const { listAuditEvents } = await import("../../src/audit/writeAudit.js");
const { formatAuditEvents, formatAuditTable, runAudit } = await import("../../src/commands/audit.js");

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventType: "override_approved",
    repoName: "custos-testing",
    repoPathHash: "abcdef1234567890",
    branch: "main",
    commitSha: "1234567890abcdef",
    userEmail: "dev@example.com",
    finding: {
      id: "hardcoded-api-key",
      severity: "critical",
      category: "secret",
      title: "Hardcoded API key detected",
      file: "demo-leak.ts",
      line: 2,
      evidence: 'const OPENAI_API_KEY = "demo-leaked-key";',
      explanation: "A key is hardcoded.",
      recommendation: "Use process.env.",
      source: "rule",
    },
    overrideReason: "key already rotated",
    jwtClaims: {
      email: "dev@example.com",
      "https://custos/finding_id": "hardcoded-api-key",
      "https://custos/severity": "critical",
    },
    action: "overridden",
    createdAt: new Date("2026-07-26T05:30:00.000Z"),
    ...overrides,
  };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.exitCode = undefined;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = undefined;
  vi.resetAllMocks();
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("formatAuditEvents", () => {
  it("renders git-log-style audit details", () => {
    const output = formatAuditEvents([makeEvent()]).join("\n");

    expect(output).toContain("Custos audit log");
    expect(output).toContain("╭");
    expect(output).toContain("│");
    expect(output).toContain("╰");
    expect(output).toContain("commit 1234567890ab");
    expect(output).not.toContain("commit 1234567890ab  override_approved");
    expect(output).toContain("override_approved");
    expect(output).toContain("Action:");
    expect(output).toContain("Action: override_approved");
    expect(output).toContain("Result:");
    expect(output).toContain("Result: overridden");
    expect(output).toContain("Repo:");
    expect(output).toContain("custos-testing");
    expect(output).toContain("User:");
    expect(output).toContain("dev@example.com");
    expect(output).toContain("Finding:");
    expect(output).toContain("Hardcoded API key detected");
    expect(output).toContain("Reason:");
    expect(output).toContain("key already rotated");
    expect(output).toContain("https://custos/finding_id: hardcoded-api-key");
  });

  it("renders an empty-state message", () => {
    const output = formatAuditEvents([]).join("\n");

    expect(output).toContain("Custos audit log");
    expect(output).toContain("No audit events found.");
  });
});

describe("formatAuditTable", () => {
  it("renders a compact table with key audit columns", () => {
    const output = formatAuditTable([makeEvent()]).join("\n");

    expect(output).not.toContain("Custos audit table");
    expect(output).toContain("╭");
    expect(output).toContain("│");
    expect(output).toContain("╰");
    expect(output).toContain("Commit");
    expect(output).toContain("Time");
    expect(output).toContain("Event");
    expect(output).toContain("Severity");
    expect(output).toContain("Finding");
    expect(output).toContain("override_approved");
    expect(output).toContain("critical");
    expect(output).toContain("Hardcoded API key detected");
    expect(output).toContain("demo-leak.ts:2");
    expect(output).toContain("dev@example.com");

    const headerLine = output.split("\n").find((line) => line.includes("Commit") && line.includes("Time"));
    expect(headerLine?.indexOf("Commit")).toBeLessThan(headerLine?.indexOf("Time") ?? Number.POSITIVE_INFINITY);
  });
});

describe("runAudit", () => {
  it("loads and prints recent audit events without paging", async () => {
    vi.mocked(listAuditEvents).mockResolvedValue([makeEvent()]);

    await runAudit({ limit: 10, pager: false });

    expect(listAuditEvents).toHaveBeenCalledWith(10);
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((call) => call[0]).join("\n")).toContain("Hardcoded API key detected");
  });

  it("prints table output when table mode is enabled", async () => {
    vi.mocked(listAuditEvents).mockResolvedValue([makeEvent()]);

    await runAudit({ limit: 10, pager: false, table: true });

    expect(process.exitCode).toBe(0);
    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).not.toContain("Custos audit table");
    expect(output).toContain("╭");
    expect(output).toContain("Hardcoded API key detected");
  });

  it("sets exit code 1 when MongoDB cannot be read", async () => {
    vi.mocked(listAuditEvents).mockRejectedValue(new Error("MONGODB_URI is not set"));

    await runAudit({ pager: false });

    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("Could not read audit events");
  });
});
