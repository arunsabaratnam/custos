import type { DiffHunk } from "../scanner/types.js";

/**
 * Parses a raw git diff string into DiffHunk[].
 *
 * Not implemented yet — Priority 2 wires this up to turn unified diff
 * output into structured hunks with added lines and surrounding context.
 */
export function parseDiff(_rawDiff: string): DiffHunk[] {
  throw new Error("parseDiff: not implemented");
}
