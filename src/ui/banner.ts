import gradient from "gradient-string";
import chalk from "chalk";

// Deep red -> amber: echoes the severity palette instead of a generic
// rainbow, so the brand banner still feels like a security tool.
const custosGradient = gradient(["#ff5f56", "#ffbd2e"]);

/**
 * Renders the animated "Checkpoint" startup banner once at the top of an
 * interactive scan. Skipped for `--json` output and for non-TTY stdout
 * (piped/redirected output), where gradient escape codes add noise rather
 * than value.
 */
export function renderBanner(): void {
  if (!process.stdout.isTTY) {
    return;
  }

  console.log("");
  console.log(custosGradient("c u s t o s"));
  console.log(chalk.dim("Pre-push security before code leaves your laptop."));
  console.log("");
}
