import { userInfo } from "node:os";
import { basename } from "node:path";
import boxen from "boxen";
import chalk from "chalk";
import { getHookStatus, readRepoConfig, resolveRepoState } from "./repoState.js";

const version = "0.1.0";
const logo = chalk.whiteBright.bold;
const label = (text: string): string => chalk.bgWhite.black.bold(` ${text} `);
const commandRow = (command: string, description: string): string => `${chalk.white(command.padEnd(18))}${chalk.gray(description)}`;

export async function runWelcome(): Promise<void> {
  const user = getDisplayName();
  const status = await getProjectStatus();

  const body = [
    logo(" ██████╗██╗   ██╗███████╗████████╗ ██████╗ ███████╗"),
    logo("██╔════╝██║   ██║██╔════╝╚══██╔══╝██╔═══██╗██╔════╝"),
    logo("██║     ██║   ██║███████╗   ██║   ██║   ██║███████╗"),
    logo("██║     ██║   ██║╚════██║   ██║   ██║   ██║╚════██║"),
    logo("╚██████╗╚██████╔╝███████║   ██║   ╚██████╔╝███████║"),
    logo(" ╚═════╝ ╚═════╝ ╚══════╝   ╚═╝    ╚═════╝ ╚══════╝"),
    "",
    chalk.white.bold("Pre-push security before code leaves your laptop."),
    chalk.gray(`v${version}`),
    "",
    chalk.bold(`Welcome back ${user}!`),
    "",
    chalk.gray("Local-first security before git push"),
    chalk.gray(status.projectLine),
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
      borderColor: "white",
      width: getWelcomeBoxWidth(),
      padding: { top: 2, bottom: 2, left: 3, right: 3 },
      margin: 1,
    }),
  );

  console.log(`${chalk.gray(">")} ${chalk.white.bold("custos select")} ${chalk.gray("Keyboard command launcher")}`);
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
      installed: installed ? chalk.white("yes") : chalk.gray("no"),
      protection: config?.enabled ? chalk.white("enabled") : chalk.gray("not initialized"),
      hook: formatHookStatus(hookStatus),
    };
  } catch {
    return {
      projectLine: "No Git repository detected",
      installed: chalk.gray("no"),
      protection: chalk.gray("not initialized"),
      hook: chalk.gray("unavailable"),
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
    return chalk.white("installed");
  }
  if (status === "modified") {
    return chalk.gray("custom hook");
  }
  return chalk.gray("missing");
}

function getWelcomeBoxWidth(): number | undefined {
  const columns = process.stdout.columns;
  if (!columns || columns < 78) {
    return undefined;
  }

  return Math.max(76, columns - 10);
}
