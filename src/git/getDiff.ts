import { execa } from "execa";

// Empty tree SHA — used to diff against nothing for brand-new branches
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Extracts the raw unified diff of commits being pushed.
 *
 * In pre-push mode, Git pipes stdin lines of the form:
 *   <local-ref> <local-sha> <remote-ref> <remote-sha>
 * Pass that stdin string here. Falls back to common diff strategies
 * for manual scans.
 */
export async function getDiff(stdin?: string): Promise<string> {
  if (stdin?.trim()) {
    const parts = stdin.trim().split(/\s+/);
    if (parts.length >= 4) {
      const localSha = parts[1]!;
      const remoteSha = parts[3]!;
      const isNewBranch = /^0+$/.test(remoteSha);
      // The empty-tree SHA is a tree object, not a commit, so triple-dot
      // (symmetric difference) is invalid against it — use two-dot instead.
      const range = isNewBranch ? `${EMPTY_TREE}..${localSha}` : `${remoteSha}...${localSha}`;
      try {
        const { stdout } = await execa("git", ["diff", "--unified=3", range]);
        if (stdout) return stdout;
      } catch {}
    }
  }

  // Manual scan fallbacks
  for (const args of [
    ["diff", "--unified=3", "origin/main...HEAD"],
    ["diff", "--unified=3", "HEAD~1..HEAD"],
    ["diff", "--unified=3", "HEAD"],
  ]) {
    try {
      const { stdout } = await execa("git", args);
      if (stdout) return stdout;
    } catch {}
  }

  return "";
}
