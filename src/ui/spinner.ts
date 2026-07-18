import ora from "ora";

/**
 * Distinct animated spinner frame sets per orchestration step, so a scan
 * feels different from AI enrichment/patch generation, which feels
 * different from an Auth0 override wait — inspired by how agentic CLIs
 * (e.g. Claude Code's multi-glyph "thinking" cycle) use dedicated spinner
 * identities per activity instead of one generic loader.
 */
export type StepKind = "scan" | "think" | "auth";

const FRAME_SETS: Record<StepKind, { interval: number; frames: string[] }> = {
  scan: {
    interval: 90,
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  },
  think: {
    interval: 140,
    frames: ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"],
  },
  auth: {
    interval: 200,
    frames: ["◜", "◠", "◝", "◞", "◡", "◟"],
  },
};

/**
 * Runs `task` behind a step-specific animated spinner. Always resolves the
 * spinner to a terminal state (succeed/fail) before this function returns
 * or throws — a spinner is never left spinning indefinitely.
 */
export async function withSpinner<T>(kind: StepKind, text: string, task: () => Promise<T>): Promise<T> {
  const spinner = ora({ text, spinner: FRAME_SETS[kind] }).start();

  try {
    const result = await task();
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

/**
 * A spinner for open-ended waits (e.g. Auth0 device-flow polling) where the
 * caller wants to update the visible elapsed time while awaiting a promise
 * that isn't itself a simple one-shot task.
 */
export function startElapsedSpinner(kind: StepKind, text: string): { stop: (finalText?: string, ok?: boolean) => void } {
  const startedAt = Date.now();
  const spinner = ora({ text, spinner: FRAME_SETS[kind] }).start();

  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    spinner.text = `${text} (${elapsed}s elapsed)`;
  }, 1000);

  return {
    stop: (finalText?: string, ok = true) => {
      clearInterval(interval);
      if (ok) {
        spinner.succeed(finalText);
      } else {
        spinner.fail(finalText);
      }
    },
  };
}
