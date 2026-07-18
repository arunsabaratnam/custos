import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const cliPath = path.resolve("src/cli.ts");
const tsxBin = path.resolve("node_modules/.bin/tsx");

async function setupTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "custos-init-test-"));
  await execa("git", ["init"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

async function runInit(cwd: string): Promise<void> {
  await execa(tsxBin, [cliPath, "init"], { cwd });
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
    await runInit(tmpDir);

    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
    const content = await fs.readFile(hookPath, "utf8");
    expect(content).toContain("custos scan --pre-push");
  });

  it("makes the hook executable", async () => {
    await runInit(tmpDir);

    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
    const stat = await fs.stat(hookPath);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it("creates .custos/config.json with protection enabled", async () => {
    await runInit(tmpDir);

    const configPath = path.join(tmpDir, ".custos", "config.json");
    const content = JSON.parse(await fs.readFile(configPath, "utf8")) as { enabled?: boolean };
    expect(content.enabled).toBe(true);
  });

  it("preserves existing hook content when custos block is not yet present", async () => {
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(path.join(hooksDir, "pre-push"), "#!/bin/sh\necho 'existing hook'\n");

    await runInit(tmpDir);

    const content = await fs.readFile(path.join(hooksDir, "pre-push"), "utf8");
    expect(content).toContain("existing hook");
    expect(content).toContain("custos scan --pre-push");
  });

  it("does not duplicate the custos scan command if already installed", async () => {
    await runInit(tmpDir);
    await runInit(tmpDir);

    const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
    const content = await fs.readFile(hookPath, "utf8");
    const count = (content.match(/custos scan --pre-push/g) ?? []).length;
    expect(count).toBe(1);
  });
});
