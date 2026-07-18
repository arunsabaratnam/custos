import type { Finding } from "../scanner/types.js";

/**
 * Renders a single Finding to the terminal (severity, file, line,
 * explanation, recommendation) per AGENTS.md's "Terminal UX Guidelines".
 *
 * Not implemented yet — later phase wires this using chalk/boxen and the
 * theme in src/ui/theme.ts.
 */
export function renderFinding(_finding: Finding): void {
  throw new Error("renderFinding: not implemented");
}
