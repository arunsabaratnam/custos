import { chmod } from "node:fs/promises";
import chalk from "chalk";
import { defaultRepoConfig, installPrePushHook, readRepoConfig, resolveRepoState, writeRepoConfig } from "./repoState.js";

export async function runInit(): Promise<void> {
  try {
    const state = await resolveRepoState();
    const hookAction = await installPrePushHook(state.hookPath);
    await chmod(state.hookPath, 0o755);
    const currentConfig = (await readRepoConfig(state.configPath)) ?? defaultRepoConfig;
    await writeRepoConfig(state.configPath, { ...currentConfig, enabled: true });

    console.log(chalk.green("Custos installed for this repository."));
    console.log(`Config: ${state.configPath}`);
    console.log(`Pre-push hook: ${state.hookPath} (${hookAction})`);
    console.log("Protection: enabled");
    console.log("");
    console.log("Run `custos` any time to see the welcome screen and setup status.");
  } catch (error) {
    renderInitError(error);
    process.exitCode = 1;
  }
}

function renderInitError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  console.error(chalk.red("Custos init failed."));

  if (isMissingGitError(error, message)) {
    console.error("Git is required before Custos can install pre-push protection.");
    console.error("Install Git first, then initialize this folder as a Git repository.");
    console.error("");
    console.error(`Next steps: ${chalk.cyan("git --version")} then ${chalk.cyan("git init")} then ${chalk.cyan("custos init")}`);
    return;
  }

  if (isNotGitRepositoryError(message)) {
    console.error("This folder is not a Git repository yet.");
    console.error("Initialize Git first, then initialize Custos.");
    console.error("");
    console.error(`Next steps: ${chalk.cyan("git init")} then ${chalk.cyan("custos init")}`);
    return;
  }

  console.error(message);
}

function isMissingGitError(error: unknown, message: string): boolean {
  return (
    (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") ||
    message.includes("Command not found: git") ||
    message.includes("spawn git ENOENT")
  );
}

function isNotGitRepositoryError(message: string): boolean {
  return message.includes("not a git repository") || message.includes("not a git repo") || message.includes("fatal: not a git repository");
}
