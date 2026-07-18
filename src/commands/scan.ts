export type ScanOptions = {
  prePush?: boolean;
  json?: boolean;
};

/**
 * `custos scan` — orchestrates the full core loop (AGENTS.md "custos scan"):
 * extract diff → parse into DiffHunk[] → run scanner rules → render
 * findings → action menu → exit 0 (allow) or 1 (block).
 *
 * Not implemented yet. In manual mode this stub exits 0 (allow) so the
 * CLI scaffold is safe to wire into a pre-push hook without blocking pushes.
 */
export async function runScan(_options: ScanOptions): Promise<void> {
  console.log("custos scan: not implemented yet.");
  process.exitCode = 0;
}
