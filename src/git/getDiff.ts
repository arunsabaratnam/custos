/**
 * Extracts the raw diff of commits being pushed.
 *
 * Not implemented yet — Priority 2 wires this up using the diff strategy
 * documented in AGENTS.md ("Git Hook and Diff Strategy"): parse stdin refs
 * from Git, then fall back through origin/main...HEAD, HEAD~1..HEAD, HEAD.
 */
export async function getDiff(_stdin?: string): Promise<string> {
  throw new Error("getDiff: not implemented");
}
