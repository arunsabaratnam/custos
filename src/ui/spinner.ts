import { startActivity, withActivity, type StepKind } from "./activity.js";

/**
 * Backwards-compatible spinner helpers, now backed by the shimmering
 * activity engine in ./activity.ts. Existing call sites keep working; the
 * richer phase API (startActivity) is available for callers that want to
 * drive live verbs/counts across a multi-step pipeline.
 */
export type { StepKind };
export { startActivity } from "./activity.js";

/**
 * Runs `task` behind a shimmering, step-specific activity. Always settles
 * (sparkle → check on success, cross on failure) before returning/throwing.
 */
export async function withSpinner<T>(kind: StepKind, text: string, task: () => Promise<T>): Promise<T> {
  return withActivity(text, task, { kind });
}

/**
 * A shimmering activity for open-ended waits (e.g. Auth0 device-flow
 * polling) that surfaces elapsed time in the live detail line.
 */
export function startElapsedSpinner(
  kind: StepKind,
  text: string,
): { stop: (finalText?: string, ok?: boolean) => Promise<void> } {
  const startedAt = Date.now();
  const activity = startActivity(text, { kind });

  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    activity.detail(`${elapsed}s elapsed`);
  }, 1000);
  interval.unref?.();

  return {
    stop: async (finalText?: string, ok = true) => {
      clearInterval(interval);
      if (ok) {
        await activity.succeed(finalText);
      } else {
        await activity.fail(finalText);
      }
    },
  };
}
