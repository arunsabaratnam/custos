import gradient from "gradient-string";
import chalk from "chalk";

const WORDMARK = "c u s t o s";

// Welcome-screen lavender with slightly deeper violet edges.
const custosGradient = gradient(["#9B6DFF", "#E0B0FF", "#B77CFF"]);

const SHIMMER_BASE: [number, number, number] = [224, 176, 255];
const SHIMMER_HIGHLIGHT: [number, number, number] = [255, 247, 255];

function animationEnabled(): boolean {
  return (
    process.stdout.isTTY === true &&
    !process.env.NO_COLOR &&
    process.env.CUSTOS_NO_ANIM !== "1"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One frame of the wordmark with a bright highlight centered at `head`. */
function sweepFrame(head: number): string {
  const chars = [...WORDMARK];
  return chars
    .map((ch, i) => {
      const t = Math.max(0, 1 - Math.abs(i - head) / 2);
      const r = Math.round(SHIMMER_BASE[0] + (SHIMMER_HIGHLIGHT[0] - SHIMMER_BASE[0]) * t);
      const g = Math.round(SHIMMER_BASE[1] + (SHIMMER_HIGHLIGHT[1] - SHIMMER_BASE[1]) * t);
      const b = Math.round(SHIMMER_BASE[2] + (SHIMMER_HIGHLIGHT[2] - SHIMMER_BASE[2]) * t);
      return chalk.rgb(r, g, b)(ch);
    })
    .join("");
}

/**
 * Renders the Custos wordmark with a single left→right shimmer sweep, then
 * settles into the static brand gradient. Skipped entirely for non-TTY
 * stdout (piped/`--json`) and when NO_COLOR / CUSTOS_NO_ANIM is set.
 */
export async function renderBanner(): Promise<void> {
  if (!process.stdout.isTTY) {
    return;
  }

  console.log("");

  if (animationEnabled()) {
    process.stdout.write("\x1b[?25l");
    try {
      for (let head = -2; head <= WORDMARK.length + 2; head++) {
        process.stdout.write(`\r\x1b[2K${sweepFrame(head)}`);
        await delay(45);
      }
    } finally {
      process.stdout.write(`\r\x1b[2K${custosGradient(WORDMARK)}\n`);
      process.stdout.write("\x1b[?25h");
    }
  } else {
    console.log(custosGradient(WORDMARK));
  }

  console.log(chalk.dim("Pre-push security before code leaves your laptop."));
  console.log("");
}
