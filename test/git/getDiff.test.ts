import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { getDiff } from "../../src/git/getDiff.js";

async function setupTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "custos-getdiff-test-"));
  await execa("git", ["init", "-b", "main"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

async function commitFile(dir: string, file: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, file), content);
  await execa("git", ["add", file], { cwd: dir });
  await execa("git", ["commit", "-m", `add ${file}`], { cwd: dir });
}

describe("getDiff", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await setupTempRepo();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns a non-empty diff containing the changed file for a manual scan (HEAD~1..HEAD fallback)", async () => {
    await commitFile(tmpDir, "a.txt", "line one\n");
    await commitFile(tmpDir, "a.txt", "line one\nline two\n");

    const diff = await getDiff();

    expect(diff).toContain("a.txt");
    expect(diff).toContain("+line two");
  });

  it("falls back to manual mode when stdin is empty", async () => {
    await commitFile(tmpDir, "a.txt", "line one\n");
    await commitFile(tmpDir, "a.txt", "line one\nline two\n");

    const diff = await getDiff("");

    expect(diff).toContain("a.txt");
  });

  it("prefers the current working tree diff for a manual scan", async () => {
    await commitFile(tmpDir, "a.txt", "line one\n");
    await fs.writeFile(path.join(tmpDir, "a.txt"), "line one\nline two\n");

    const diff = await getDiff();

    expect(diff).toContain("a.txt");
    expect(diff).toContain("+line two");
  });

  it("returns an empty string when there is nothing to diff", async () => {
    await commitFile(tmpDir, "a.txt", "line one\n");

    const diff = await getDiff();

    expect(diff).toBe("");
  });

  it("uses stdin ref pairs to diff against the empty tree for a brand-new branch", async () => {
    await commitFile(tmpDir, "a.txt", "line one\n");
    const { stdout: localSha } = await execa("git", ["rev-parse", "HEAD"], { cwd: tmpDir });
    const remoteAllZeroes = "0".repeat(40);
    const stdin = `refs/heads/main ${localSha.trim()} refs/heads/main ${remoteAllZeroes}\n`;

    const diff = await getDiff(stdin);

    expect(diff).toContain("a.txt");
    expect(diff).toContain("+line one");
  });
});
