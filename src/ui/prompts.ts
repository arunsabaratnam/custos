import readline from "node:readline";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { accent } from "./theme.js";

export type FindingAction = "apply-patch" | "view-details" | "override" | "abort";
export type FindingActionMode = "manual" | "pre-push";
type FindingActionOption = { value: FindingAction; label: string; hint?: string };

export type FindingActionOptions = {
  hasPatch?: boolean;
  mode?: FindingActionMode;
};

export function buildFindingActionOptions({
  hasPatch = false,
  mode = "manual",
}: FindingActionOptions = {}): FindingActionOption[] {
  const abortLabel = mode === "pre-push" ? "Abort push" : "Exit scan";
  return [
    ...(hasPatch ? [{ value: "apply-patch" as const, label: "Apply suggested patch", hint: "edit the file and block this push" }] : []),
    { value: "view-details", label: "View technical details" },
    { value: "override", label: "Force override with Auth0", hint: "requires audit reason" },
    { value: "abort", label: abortLabel },
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

export async function promptReturnToActions(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return;
  }

  await clack.text({
    message: "Press Enter to return to actions",
    placeholder: "",
  });
}

export async function promptConfirm(message: string, initialValue = false): Promise<boolean> {
  const result = await clack.confirm({ message, initialValue });

  if (clack.isCancel(result)) {
    return false;
  }

  return result;
}

export async function promptOverrideReason(): Promise<string> {
  const result = await clack.text({
    message: "Why are you overriding this finding? (required for audit log)",
    placeholder: "e.g., key is already rotated, not in production path",
    validate: (value) => (!value.trim() ? "A reason is required to override." : undefined),
  });

  if (clack.isCancel(result)) {
    return "";
  }

  return result.trim();
}
