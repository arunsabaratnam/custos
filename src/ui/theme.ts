import chalk from "chalk";
import type { Severity } from "../scanner/types.js";

export const severityColor: Record<Severity, (text: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.yellow.bold,
  medium: chalk.blue,
  low: chalk.gray,
};

export const boxenTheme = {
  padding: 1,
  borderColor: "red",
  borderStyle: "round" as const,
};
