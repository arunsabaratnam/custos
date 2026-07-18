import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execa } from "execa";

export type RepoConfig = {
  version: 1;
  enabled: boolean;
  blockingThreshold: string[];
  ai: {
    enabled: boolean;
  };
  audit: {
    enabled: boolean;
  };
};

export type RepoState = {
  repoRoot: string;
  gitCommonDir: string;
  configPath: string;
  hookPath: string;
};

export const defaultRepoConfig: RepoConfig = {
  version: 1,
  enabled: true,
  blockingThreshold: ["critical", "high"],
  ai: {
    enabled: true,
  },
  audit: {
    enabled: true,
  },
};

const hookStart = "# >>> custos pre-push >>>";
const hookEnd = "# <<< custos pre-push <<<";

export function buildHookBlock(): string {
  return [
    hookStart,
    'if [ -f ".custos/config.json" ] && grep -q \'"enabled"[[:space:]]*:[[:space:]]*false\' ".custos/config.json"; then',
    "  exit 0",
    "fi",
    "custos scan --pre-push",
    hookEnd,
  ].join("\n");
}

export async function resolveRepoState(cwd = process.cwd()): Promise<RepoState> {
  const repoRootResult = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
  const gitCommonDirResult = await execa("git", ["rev-parse", "--git-common-dir"], { cwd });
  const repoRoot = repoRootResult.stdout.trim();
  const gitCommonDir = resolve(repoRoot, gitCommonDirResult.stdout.trim());

  return {
    repoRoot,
    gitCommonDir,
    configPath: join(repoRoot, ".custos", "config.json"),
    hookPath: join(gitCommonDir, "hooks", "pre-push"),
  };
}

export async function readRepoConfig(configPath: string): Promise<RepoConfig | null> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RepoConfig>;

    return {
      ...defaultRepoConfig,
      ...parsed,
      ai: {
        ...defaultRepoConfig.ai,
        ...parsed.ai,
      },
      audit: {
        ...defaultRepoConfig.audit,
        ...parsed.audit,
      },
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeRepoConfig(configPath: string, config: RepoConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function installPrePushHook(hookPath: string): Promise<"created" | "updated" | "unchanged"> {
  await mkdir(dirname(hookPath), { recursive: true });
  const block = buildHookBlock();
  const existing = await readTextIfExists(hookPath);

  let next = "";
  let action: "created" | "updated" | "unchanged" = "created";

  if (!existing) {
    next = `#!/bin/sh\n${block}\n`;
  } else if (existing.includes(block)) {
    action = "unchanged";
    next = existing;
  } else if (existing.includes(hookStart) && existing.includes(hookEnd)) {
    action = "updated";
    next = existing.replace(new RegExp(`${escapeRegExp(hookStart)}[\\s\\S]*?${escapeRegExp(hookEnd)}`), block);
  } else {
    action = "updated";
    const normalized = existing.endsWith("\n") ? existing : `${existing}\n`;
    const withShebang = normalized.startsWith("#!") ? normalized : `#!/bin/sh\n${normalized}`;
    next = `${withShebang}\n${block}\n`;
  }

  if (action !== "unchanged") {
    await writeFile(hookPath, next, { encoding: "utf8", mode: 0o755 });
  }

  return action;
}

export async function getHookStatus(hookPath: string): Promise<"missing" | "installed" | "modified"> {
  const existing = await readTextIfExists(hookPath);
  if (!existing) {
    return "missing";
  }
  return existing.includes(hookStart) && existing.includes("custos scan --pre-push") ? "installed" : "modified";
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
