import { rules } from "./rules.js";
import type { DiffHunk, Finding } from "./types.js";

export function scanDiff(hunks: DiffHunk[]): Finding[] {
  const findings: Finding[] = [];
  for (const hunk of hunks) {
    for (const rule of rules) {
      const finding = rule(hunk);
      if (finding) {
        findings.push(finding);
      }
    }
  }
  return findings;
}
