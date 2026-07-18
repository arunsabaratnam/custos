import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("custos CLI", () => {
  it("prints the welcome screen when run without a command", async () => {
    const { stdout } = await execa("npx", ["tsx", "src/cli.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
    });

    expect(stdout).toContain("c u s t o s");
    expect(stdout).toContain("Pre-push security before code leaves your laptop.");
    expect(stdout).toContain("Getting started");
    expect(stdout).toContain("custos init");
  });

  it("prints help output listing all commands", async () => {
    const { stdout } = await execa("npx", ["tsx", "src/cli.ts", "--help"], {
      cwd: new URL("..", import.meta.url).pathname,
    });

    expect(stdout).toContain("init");
    expect(stdout).toContain("scan");
    expect(stdout).toContain("audit");
    expect(stdout).toContain("doctor");
  });
});
