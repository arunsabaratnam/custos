import chalk from "chalk";

const commands = [
  {
    name: "custos",
    summary: "Show the welcome screen and current repo setup status.",
  },
  {
    name: "custos init",
    summary: "Install Custos in the current Git repo and enable pre-push protection.",
  },
  {
    name: "custos scan",
    summary: "Manually scan the current Git diff for security findings.",
  },
  {
    name: "custos scan --pre-push",
    summary: "Run scan mode from the Git pre-push hook.",
  },
  {
    name: "custos scan --json",
    summary: "Emit machine-readable scan output for scripts or agents.",
  },
  {
    name: "custos select",
    summary: "Navigate common Custos commands with the keyboard.",
  },
  {
    name: "custos audit",
    summary: "Show recent security events from the MongoDB audit ledger.",
  },
  {
    name: "custos doctor",
    summary: "Check Git hook setup, config files, and integration environment variables.",
  },
  {
    name: "custos help",
    summary: "Show this simple command guide.",
  },
];

export async function runHelp(): Promise<void> {
  console.log(chalk.bold("Custos commands"));
  console.log("");

  for (const command of commands) {
    console.log(`${chalk.cyan(command.name.padEnd(24))}${command.summary}`);
  }

  console.log("");
  console.log(`Run ${chalk.cyan("custos --help")} for Commander options and flags.`);
}
