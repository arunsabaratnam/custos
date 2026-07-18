import boxen from "boxen";
import chalk from "chalk";
import type { Finding } from "../scanner/types.js";
import { boxenTheme, severityColor } from "./theme.js";

export function renderFinding(finding: Finding): void {
  const color = severityColor[finding.severity];
  const badge = color(` ${finding.severity.toUpperCase()} `);
  const location = `${chalk.cyan(finding.file)}${finding.line ? `:${finding.line}` : ""}`;

  const body = [
    `${badge}  ${chalk.bold(finding.title)}`,
    location,
    "",
    chalk.bold("Why this matters:"),
    finding.explanation,
    "",
    chalk.bold("Suggested fix:"),
    finding.recommendation,
  ].join("\n");

  console.log(
    boxen(body, {
      ...boxenTheme,
      borderStyle: finding.severity === "critical" ? "double" : "round",
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
    }),
  );
}
