import { userInfo } from "node:os";
import { basename } from "node:path";
import boxen from "boxen";
import chalk from "chalk";
import { getHookStatus, readRepoConfig, resolveRepoState } from "./repoState.js";

const version = "0.1.0";
const accent = chalk.hex("#E0B0FF");
const label = chalk.white.bold;
const commandRow = (command: string, description: string): string => `${accent(command.padEnd(18))}${chalk.white(description)}`;

export async function runWelcome(): Promise<void> {
  const user = getDisplayName();
  const status = await getProjectStatus();

  const body = [
    accent(" ██████╗██╗   ██╗███████╗████████╗ ██████╗ ███████╗"),
    accent("██╔════╝██║   ██║██╔════╝╚══██╔══╝██╔═══██╗██╔════╝"),
    accent("██║     ██║   ██║███████╗   ██║   ██║   ██║███████╗"),
    accent("██║     ██║   ██║╚════██║   ██║   ██║   ██║╚════██║"),
    accent("╚██████╗╚██████╔╝███████║   ██║   ╚██████╔╝███████║"),
    accent(" ╚═════╝ ╚═════╝ ╚══════╝   ╚═╝    ╚═════╝ ╚══════╝"),
    "",
    chalk.white.bold("Pre-push security before code leaves your laptop."),
    chalk.white.bold(`v${version}`),
    "",
    chalk.white.bold(`Welcome back ${user}!`),
    "",
    chalk.white("Local-first security before git push"),
    chalk.white(status.projectLine),
    "",
    label("Getting started"),
    commandRow("custos init", "Initialize repo"),
    commandRow("custos scan", "Run a scan"),
    commandRow("custos doctor", "Check setup"),
    commandRow("custos select", "Navigate commands"),
    "",
    label("Project status"),
    `${chalk.white("Installed")}        ${status.installed}`,
    `${chalk.white("Protection")}       ${status.protection}`,
    `${chalk.white("Hook")}             ${status.hook}`,
  ].join("\n");

  console.log(
    boxen(body, {
      borderColor: "#E0B0FF",
      width: getWelcomeBoxWidth(),
      padding: { top: 2, bottom: 2, left: 3, right: 3 },
      margin: 1,
    }),
  );

  console.log(`${chalk.white(">")} ${accent("custos select")} ${chalk.white("Keyboard command launcher")}`);
}

async function getProjectStatus(): Promise<{
  projectLine: string;
  installed: string;
  protection: string;
  hook: string;
}> {
  try {
    const state = await resolveRepoState();
    const config = await readRepoConfig(state.configPath);
    const hookStatus = await getHookStatus(state.hookPath);
    const installed = Boolean(config) && hookStatus === "installed";

    return {
      projectLine: `Project: ${basename(state.repoRoot)}`,
      installed: installed ? accent("yes") : chalk.white.bold("no"),
      protection: config?.enabled ? accent("enabled") : chalk.white.bold("not initialized"),
      hook: formatHookStatus(hookStatus),
    };
  } catch {
    return {
      projectLine: "No Git repository detected",
      installed: chalk.white.bold("no"),
      protection: chalk.white.bold("not initialized"),
      hook: chalk.white.bold("unavailable"),
    };
  }
}

function getDisplayName(): string {
  try {
    return userInfo().username || "developer";
  } catch {
    return "developer";
  }
}

function formatHookStatus(status: "missing" | "installed" | "modified"): string {
  if (status === "installed") {
    return accent("installed");
  }
  if (status === "modified") {
    return chalk.white.bold("custom hook");
  }
  return chalk.white.bold("missing");
}

function getWelcomeBoxWidth(): number | undefined {
  const columns = process.stdout.columns;
  if (!columns || columns < 78) {
    return undefined;
  }

  return Math.max(76, columns - 10);
}
