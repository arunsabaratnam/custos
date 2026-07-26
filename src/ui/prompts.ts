import readline from "node:readline";
import chalk from "chalk";
import type { Finding } from "../scanner/types.js";
import { accent, severityColor } from "./theme.js";

export type FindingAction = "apply-patch" | "view-details" | "override" | "back" | "abort";
export type FindingActionMode = "manual" | "pre-push";
type FindingActionOption = { value: FindingAction; label: string; hint?: string };
type IssueSelectionOption = { value: number | "abort"; label: string; hint?: string };

export type FindingActionOptions = {
  hasPatch?: boolean;
  mode?: FindingActionMode;
  allowOverride?: boolean;
  showBack?: boolean;
};

export function buildFindingActionOptions({
  hasPatch = false,
  mode = "manual",
  allowOverride = false,
  showBack = false,
}: FindingActionOptions = {}): FindingActionOption[] {
  const abortLabel = mode === "pre-push" ? "Abort push" : "Exit scan";
  return [
    ...(hasPatch ? [{ value: "apply-patch" as const, label: "Apply suggested patch", hint: "edit the file and block this push" }] : []),
    { value: "view-details", label: "View technical details" },
    ...(mode === "pre-push" && allowOverride
      ? [{ value: "override" as const, label: "Force override with Auth0", hint: "requires audit reason" }]
      : []),
    ...(showBack ? [{ value: "back" as const, label: "Back to issues" }] : []),
    { value: "abort", label: abortLabel },
  ];
}

export function buildIssueSelectionOptions(
  findings: Finding[],
  { mode = "manual" }: { mode?: FindingActionMode } = {},
): IssueSelectionOption[] {
  const abortLabel = mode === "pre-push" ? "Abort push" : "Exit scan";
  return [
    ...findings.map((finding, index) => ({
      value: index,
      label: `${finding.severity.toUpperCase()}  ${finding.title}`,
      hint: `${finding.file}${finding.line ? `:${finding.line}` : ""}`,
    })),
    { value: "abort" as const, label: abortLabel },
  ];
}

export async function promptFindingAction(options: FindingActionOptions = {}): Promise<FindingAction> {
  const choices = buildFindingActionOptions(options);
  const initialValue: FindingAction = options.hasPatch ? "apply-patch" : "abort";
  let cursor = Math.max(0, choices.findIndex((choice) => choice.value === initialValue));

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "abort";
  }

  const input = process.stdin;
  const output = process.stdout;
  let renderedLines = 0;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);

  const render = (): void => {
    if (renderedLines > 0) {
      output.write(`\x1b[${renderedLines}A\x1b[J`);
    }

    const lines = [
      accent("│"),
      `${accent("◆")}  ${chalk.white.bold("What do you want to do?")}`,
      ...choices.map((choice, index) => {
        const selected = index === cursor;
        const marker = selected ? accent("●") : chalk.gray("○");
        const label = selected ? chalk.white.bold(choice.label) : chalk.white(choice.label);
        const hint = choice.hint ? chalk.gray(` (${choice.hint})`) : "";
        return `${accent("│")}  ${marker} ${label}${hint}`;
      }),
      accent("└"),
    ];

    renderedLines = lines.length;
    output.write(`${lines.join("\n")}\n`);
  };

  return new Promise<FindingAction>((resolve) => {
    const cleanup = (value: FindingAction): void => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      output.write("\n");
      resolve(value);
    };

    const onKeypress = (_char: string, key: readline.Key): void => {
      if (key.name === "up" || key.name === "k") {
        cursor = cursor === 0 ? choices.length - 1 : cursor - 1;
        render();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        cursor = cursor === choices.length - 1 ? 0 : cursor + 1;
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup(choices[cursor]?.value ?? "abort");
        return;
      }

      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup("abort");
      }
    };

    input.on("keypress", onKeypress);
    render();
  });
}

export async function promptIssueSelection(
  findings: Finding[],
  options: { mode?: FindingActionMode } = {},
): Promise<number | "abort"> {
  const choices = buildIssueSelectionOptions(findings, options);
  let cursor = 0;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "abort";
  }

  const input = process.stdin;
  const output = process.stdout;
  let renderedLines = 0;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);

  const render = (): void => {
    if (renderedLines > 0) {
      output.write(`\x1b[${renderedLines}A\x1b[J`);
    }

    const lines = [
      accent("│"),
      `${accent("◆")}  ${chalk.white.bold("Which issue do you want to analyze?")}`,
      ...choices.map((choice, index) => {
        const selected = index === cursor;
        const marker = selected ? accent("●") : chalk.gray("○");
        const label = formatIssueChoice(choice, selected);
        const hint = choice.hint ? chalk.gray(` (${choice.hint})`) : "";
        return `${accent("│")}  ${marker} ${label}${hint}`;
      }),
      accent("└"),
    ];

    renderedLines = lines.length;
    output.write(`${lines.join("\n")}\n`);
  };

  return new Promise<number | "abort">((resolve) => {
    const cleanup = (value: number | "abort"): void => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      output.write("\n");
      resolve(value);
    };

    const onKeypress = (_char: string, key: readline.Key): void => {
      if (key.name === "up" || key.name === "k") {
        cursor = cursor === 0 ? choices.length - 1 : cursor - 1;
        render();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        cursor = cursor === choices.length - 1 ? 0 : cursor + 1;
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup(choices[cursor]?.value ?? "abort");
        return;
      }

      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup("abort");
      }
    };

    input.on("keypress", onKeypress);
    render();
  });
}

function formatIssueChoice(choice: IssueSelectionOption, selected: boolean): string {
  if (choice.value === "abort") {
    return selected ? chalk.white.bold(choice.label) : chalk.white(choice.label);
  }

  const [severity = "", ...titleParts] = choice.label.split(/\s{2,}/);
  const color = severityColor[severity.toLowerCase() as keyof typeof severityColor] ?? chalk.white;
  const severityLabel = color(severity);
  const title = selected ? chalk.white.bold(titleParts.join("  ")) : chalk.white(titleParts.join("  "));
  return `${severityLabel}  ${title}`;
}

export async function promptReturnToActions(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  await waitForEnter("Press Enter to return to actions");
}

export async function promptConfirm(message: string, initialValue = false): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const input = process.stdin;
  const output = process.stdout;
  let value = initialValue;
  let renderedLines = 0;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);

  const render = (): void => {
    if (renderedLines > 0) {
      output.write(`\x1b[${renderedLines}A\x1b[J`);
    }

    const yesMarker = value ? accent("●") : chalk.gray("○");
    const noMarker = !value ? accent("●") : chalk.gray("○");
    const yesLabel = value ? chalk.white.bold("Yes") : chalk.white("Yes");
    const noLabel = !value ? chalk.white.bold("No") : chalk.white("No");
    const lines = [
      accent("│"),
      `${accent("◆")}  ${chalk.white.bold(message)}`,
      `${accent("│")}  ${yesMarker} ${yesLabel}  ${noMarker} ${noLabel}`,
      accent("└"),
    ];

    renderedLines = lines.length;
    output.write(`${lines.join("\n")}\n`);
  };

  return new Promise<boolean>((resolve) => {
    const cleanup = (confirmed: boolean): void => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      output.write("\n");
      resolve(confirmed);
    };

    const onKeypress = (char: string, key: readline.Key): void => {
      if (key.name === "left" || key.name === "right" || key.name === "tab") {
        value = !value;
        render();
        return;
      }

      if (char?.toLowerCase() === "y") {
        cleanup(true);
        return;
      }

      if (char?.toLowerCase() === "n") {
        cleanup(false);
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup(value);
        return;
      }

      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup(false);
      }
    };

    input.on("keypress", onKeypress);
    render();
  });
}

export async function promptOverrideReason(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "";
  }

  for (;;) {
    const result = await promptLine(
      "Why are you overriding this finding? (required for audit log)",
      "e.g., key is already rotated, not in production path",
    );
    const trimmed = result.trim();
    if (trimmed) return trimmed;

    console.log(chalk.yellow("A reason is required to override."));
  }
}

function waitForEnter(message: string): Promise<void> {
  const input = process.stdin;
  const output = process.stdout;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);

  output.write(`${accent("│")}\n${accent("◆")}  ${chalk.white.bold(message)}\n${accent("└")}`);

  return new Promise<void>((resolve) => {
    const cleanup = (): void => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      output.write("\n\n");
      resolve();
    };

    const onKeypress = (_char: string, key: readline.Key): void => {
      if (key.name === "return" || key.name === "enter" || key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
      }
    };

    input.on("keypress", onKeypress);
  });
}

function promptLine(message: string, placeholder: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  const rl = readline.createInterface({ input, output });

  output.write(`${accent("│")}\n${accent("◇")}  ${chalk.white.bold(message)}\n`);
  output.write(`${accent("│")}  ${chalk.gray(placeholder)}\n`);

  return new Promise<string>((resolve) => {
    rl.question(`${accent("└")}  `, (answer) => {
      rl.close();
      output.write("\n");
      resolve(answer);
    });
  });
}
