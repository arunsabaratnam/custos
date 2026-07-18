import chalk from "chalk";

/**
 * Terminal "activity" animations — the shimmering, phase-aware progress
 * indicator used across Custos. Inspired by agentic CLIs (e.g. Claude Code):
 * a present-continuous verb that changes as real work happens, a gold→white
 * shimmer sweeping across it, live detail counts, and a sparkle-settle when
 * the step completes.
 *
 * Everything is written to **stderr** so machine-readable stdout (e.g.
 * `custos scan --json`) is never corrupted. When stderr is not an
 * interactive TTY — the git pre-push hook, CI, redirected output — or when
 * NO_COLOR / CUSTOS_NO_ANIM is set, the engine is fully inert: it creates no
 * timers (protecting the "hook must never hang" invariant) and prints at
 * most a single plain result line per step.
 */

export type StepKind = "scan" | "think" | "auth";

export type Activity = {
  update(verb: string): void;
  detail(text: string | null): void;
  succeed(label?: string): Promise<void>;
  fail(label?: string): Promise<void>;
};

const GOLD: [number, number, number] = [255, 189, 46];
const WHITE: [number, number, number] = [255, 255, 255];
const SHIMMER_WIDTH = 3;
const FRAME_MS = 80;

const ACCENT: Record<StepKind, string> = { scan: "✦", think: "✳", auth: "◆" };

function animationEnabled(): boolean {
  return (
    process.stderr.isTTY === true &&
    !process.env.NO_COLOR &&
    process.env.CUSTOS_NO_ANIM !== "1"
  );
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * Pure: the rgb a character should take given its index and the current
 * shimmer head position. Brightest (white) at the head, fading to gold with
 * distance. Exported for unit testing.
 */
export function shimmerColor(charIndex: number, headPos: number, _len: number): [number, number, number] {
  const distance = Math.abs(charIndex - headPos);
  const t = Math.max(0, 1 - distance / SHIMMER_WIDTH);
  return [lerp(GOLD[0], WHITE[0], t), lerp(GOLD[1], WHITE[1], t), lerp(GOLD[2], WHITE[2], t)];
}

// --- cursor hygiene ---------------------------------------------------------

let cursorHidden = false;
let exitHookRegistered = false;

function hideCursor(): void {
  if (!cursorHidden) {
    process.stderr.write("\x1b[?25l");
    cursorHidden = true;
    if (!exitHookRegistered) {
      exitHookRegistered = true;
      process.on("exit", showCursor);
    }
  }
}

function showCursor(): void {
  if (cursorHidden) {
    process.stderr.write("\x1b[?25h");
    cursorHidden = false;
  }
}

function writeLine(content: string): void {
  process.stderr.write(`\r\x1b[2K${content}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- engine -----------------------------------------------------------------

class AnimatedActivity implements Activity {
  private verb: string;
  private detailText: string | null = null;
  private head = -SHIMMER_WIDTH;
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private done = false;
  private readonly accent: string;

  constructor(verb: string, kind: StepKind) {
    this.verb = verb;
    this.accent = ACCENT[kind];
    hideCursor();
    this.render();
    this.timer = setInterval(() => this.tick(), FRAME_MS);
  }

  private tick(): void {
    this.frame += 1;
    this.head += 1;
    if (this.head > this.verb.length + SHIMMER_WIDTH) {
      this.head = -SHIMMER_WIDTH;
    }
    this.render();
  }

  private render(): void {
    const chars = [...this.verb];
    const colored = chars
      .map((ch, i) => {
        const [r, g, b] = shimmerColor(i, this.head, chars.length);
        return chalk.rgb(r, g, b)(ch);
      })
      .join("");
    const pulse = this.frame % 8 < 4 ? chalk.rgb(...WHITE) : chalk.rgb(...GOLD);
    const detail = this.detailText ? chalk.dim(` · ${this.detailText}`) : "";
    writeLine(` ${pulse(this.accent)}  ${colored}${detail}`);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  update(verb: string): void {
    if (this.done) return;
    this.verb = verb;
    this.detailText = null;
    this.head = -SHIMMER_WIDTH;
    this.render();
  }

  detail(text: string | null): void {
    if (this.done) return;
    this.detailText = text;
    this.render();
  }

  async succeed(label?: string): Promise<void> {
    await this.settle(true, label);
  }

  async fail(label?: string): Promise<void> {
    await this.settle(false, label);
  }

  private async settle(ok: boolean, label?: string): Promise<void> {
    if (this.done) return;
    this.done = true;
    this.stopTimer();

    if (ok) {
      // Sparkle flourish, then collapse into the final check.
      const sparkles = ["✦ ✧ ✦", "✧ ✦ ✧", "· ✦ ·", "✦ · ✦"];
      for (const s of sparkles) {
        writeLine(` ${chalk.rgb(...GOLD)(s)}`);
        await delay(70);
      }
      writeLine(` ${chalk.green("✓")}  ${chalk.green(label ?? this.verb)}\n`);
    } else {
      writeLine(` ${chalk.red("✗")}  ${chalk.red(label ?? this.verb)}\n`);
    }
    showCursor();
  }
}

class StaticActivity implements Activity {
  private verb: string;
  private done = false;

  constructor(verb: string) {
    this.verb = verb;
  }

  update(verb: string): void {
    this.verb = verb;
  }

  detail(): void {
    // no-op: intermediate detail is noise in non-interactive logs.
  }

  async succeed(label?: string): Promise<void> {
    if (this.done) return;
    this.done = true;
    process.stderr.write(`${chalk.green("✓")} ${label ?? this.verb}\n`);
  }

  async fail(label?: string): Promise<void> {
    if (this.done) return;
    this.done = true;
    process.stderr.write(`${chalk.red("✗")} ${label ?? this.verb}\n`);
  }
}

export function startActivity(verb: string, opts: { kind?: StepKind } = {}): Activity {
  const kind = opts.kind ?? "scan";
  return animationEnabled() ? new AnimatedActivity(verb, kind) : new StaticActivity(verb);
}

/** Convenience wrapper for a one-shot step: start → run → succeed/fail. */
export async function withActivity<T>(
  verb: string,
  task: () => Promise<T>,
  opts: { kind?: StepKind; successLabel?: string } = {},
): Promise<T> {
  const activity = startActivity(verb, opts);
  try {
    const result = await task();
    await activity.succeed(opts.successLabel);
    return result;
  } catch (err) {
    await activity.fail();
    throw err;
  }
}
