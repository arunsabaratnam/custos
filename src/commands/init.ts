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
    console.error(chalk.red("Custos init failed."));
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
