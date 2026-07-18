import * as readline from "node:readline";
import chalk from "chalk";
import { runAudit } from "./audit.js";
import { runDoctor } from "./doctor.js";
import { runHelp } from "./help.js";
import { runInit } from "./init.js";
import { getHookStatus, readRepoConfig, resolveRepoState } from "./repoState.js";
import { runScan } from "./scan.js";

type SelectAction = "init" | "scan" | "doctor" | "audit" | "help" | "exit";
const accent = chalk.hex("#E0B0FF");

export async function runSelect(): Promise<void> {
  if (!isInteractiveTerminal()) {
    console.log(chalk.white("Select requires an interactive terminal."));
    console.log(`Run ${accent("custos help")} to view available commands.`);
    return;
  }

  const action = await promptSelectAction((await isCustosInstalled()) ? "scan" : "init");
  await runSelectAction(action);
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

async function isCustosInstalled(): Promise<boolean> {
  try {
    const state = await resolveRepoState();
    const config = await readRepoConfig(state.configPath);
    const hookStatus = await getHookStatus(state.hookPath);
    return Boolean(config?.enabled && hookStatus === "installed");
  } catch {
    return false;
  }
}

async function promptSelectAction(initialValue: SelectAction): Promise<SelectAction> {
  const options: Array<{ value: SelectAction; label: string; command?: string }> = [
    { value: "init", label: "Initialize this repo", command: "custos init" },
    { value: "scan", label: "Run security scan", command: "custos scan" },
    { value: "doctor", label: "Check setup", command: "custos doctor" },
    { value: "audit", label: "View audit ledger", command: "custos audit" },
    { value: "help", label: "Show command guide", command: "custos help" },
    { value: "exit", label: "Exit" },
  ];
  let selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === initialValue),
  );
  let renderedLines = 0;

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve) => {
    const render = (): void => {
      if (renderedLines > 0) {
        readline.moveCursor(process.stdout, 0, -renderedLines);
        for (let index = 0; index < renderedLines; index += 1) {
          readline.clearLine(process.stdout, 0);
          if (index < renderedLines - 1) {
            readline.moveCursor(process.stdout, 0, 1);
          }
        }
        readline.moveCursor(process.stdout, 0, -(renderedLines - 1));
      }

      const lines = [
        accent("custos select"),
        chalk.white("Use up/down arrows, then Enter:"),
        "",
        ...options.map((option, index) => {
          const pointer = index === selectedIndex ? accent(">") : " ";
          const name = chalk.white(option.label);
          const command = option.command ? `  ${accent(option.command)}` : "";
          return `${pointer} ${name}${command}`;
        }),
      ];

      process.stdout.write(`${lines.join("\n")}\n`);
      renderedLines = lines.length;
    };

    const cleanup = (): void => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onKeypress = (_input: string, key: readline.Key): void => {
      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
        return;
      }

      if (key.name === "return") {
        const action = options[selectedIndex]?.value ?? "exit";
        cleanup();
        resolve(action);
        return;
      }

      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        resolve("exit");
      }
    };

    process.stdin.on("keypress", onKeypress);
    render();
  });
}

async function runSelectAction(action: SelectAction): Promise<void> {
  if (action === "init") {
    await runInit();
    return;
  }
  if (action === "scan") {
    await runScan({});
    return;
  }
  if (action === "doctor") {
    await runDoctor();
    return;
  }
  if (action === "audit") {
    await runAudit();
    return;
  }
  if (action === "help") {
    await runHelp();
  }
}
