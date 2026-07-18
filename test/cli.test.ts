import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("custos CLI", () => {
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
