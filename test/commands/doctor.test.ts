import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(async () => ({ stdout: "git version 2.50.0" })),
}));

vi.mock("../../src/commands/repoState.js", () => ({
  resolveRepoState: vi.fn(async () => ({
    repoRoot: "/repo",
    gitCommonDir: "/repo/.git",
    configPath: "/repo/.custos/config.json",
    hookPath: "/repo/.git/hooks/pre-push",
  })),
  readRepoConfig: vi.fn(async () => null),
}));

vi.mock("../../src/audit/mongo.js", () => ({
  connectMongo: vi.fn(async () => ({})),
}));

const { readRepoConfig } = await import("../../src/commands/repoState.js");
const { connectMongo } = await import("../../src/audit/mongo.js");
const { runDoctor } = await import("../../src/commands/doctor.js");

const ORIGINAL_ENV = process.env;

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CUSTOS_ALLOW_OVERRIDE;
  delete process.env.AUTH0_DOMAIN;
  delete process.env.AUTH0_CLIENT_ID;
  delete process.env.AUTH0_AUDIENCE;
  delete process.env.AUTH0_CLIENT_SECRET;
  delete process.env.MONGODB_URI;
  delete process.env.CUSTOS_AUDIT_ENABLED;
  process.exitCode = undefined;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  process.exitCode = undefined;
  vi.resetAllMocks();
  logSpy.mockRestore();
});

describe("runDoctor", () => {
  it("does not require Auth0 configuration when override is disabled", async () => {
    await runDoctor();

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(process.exitCode).toBe(0);
    expect(output).toContain("Auth0 override");
    expect(output).toContain("disabled");
    expect(output).not.toContain("required when Auth0 override is enabled");
  });

  it("requires Auth0 domain and client id when override is enabled", async () => {
    process.env.CUSTOS_ALLOW_OVERRIDE = "true";

    await runDoctor();

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(process.exitCode).toBe(1);
    expect(output).toContain("AUTH0_DOMAIN");
    expect(output).toContain("AUTH0_CLIENT_ID");
    expect(output).not.toContain("AUTH0_AUDIENCE");
    expect(output).toContain("required when Auth0 override is enabled");
  });

  it("uses repo config auth settings before env fallback", async () => {
    process.env.CUSTOS_ALLOW_OVERRIDE = "false";
    process.env.AUTH0_DOMAIN = "example.auth0.com";
    process.env.AUTH0_CLIENT_ID = "client-id";
    vi.mocked(readRepoConfig).mockResolvedValueOnce({
      version: 1,
      enabled: true,
      blockingThreshold: ["critical", "high"],
      patchFormat: "replace",
      ai: { enabled: true },
      audit: { enabled: true },
      auth: { enabled: true, provider: "auth0" },
    });

    await runDoctor();

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(process.exitCode).toBe(0);
    expect(output).toContain("Auth0 override");
    expect(output).toContain("enabled");
  });

  it("allows env to enable Auth0 override when repo config leaves it disabled", async () => {
    process.env.CUSTOS_ALLOW_OVERRIDE = "true";
    process.env.AUTH0_DOMAIN = "example.auth0.com";
    process.env.AUTH0_CLIENT_ID = "client-id";
    vi.mocked(readRepoConfig).mockResolvedValueOnce({
      version: 1,
      enabled: true,
      blockingThreshold: ["critical", "high"],
      patchFormat: "replace",
      ai: { enabled: true },
      audit: { enabled: true },
      auth: { enabled: false, provider: "auth0" },
    });

    await runDoctor();

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(process.exitCode).toBe(0);
    expect(output).toContain("Auth0 override");
    expect(output).toContain("enabled");
    expect(output).not.toContain("AUTH0_AUDIENCE");
  });

  it("shows Auth0 audience only when it is configured", async () => {
    process.env.CUSTOS_ALLOW_OVERRIDE = "true";
    process.env.AUTH0_DOMAIN = "example.auth0.com";
    process.env.AUTH0_CLIENT_ID = "client-id";
    process.env.AUTH0_AUDIENCE = "https://api.example.com";

    await runDoctor();

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(process.exitCode).toBe(0);
    expect(output).toContain("AUTH0_AUDIENCE");
    expect(output).toContain("configured");
  });

  it("tests the configured MongoDB connection", async () => {
    process.env.MONGODB_URI = "mongodb://example.test/custos";

    await runDoctor();

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(connectMongo).toHaveBeenCalledOnce();
    expect(output).toContain("MongoDB connection");
    expect(output).toContain("connected");
  });

  it("fails doctor when configured MongoDB cannot be reached", async () => {
    process.env.MONGODB_URI = "mongodb://example.test/custos";
    vi.mocked(connectMongo).mockRejectedValueOnce(new Error("unreachable"));

    await runDoctor();

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(process.exitCode).toBe(1);
    expect(output).toContain("connection failed");
  });
});
