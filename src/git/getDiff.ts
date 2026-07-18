import { execa } from "execa";

// Empty tree SHA — used to diff against nothing for brand-new branches
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const ZERO_SHA = /^0+$/;

export type RefUpdate = {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
};

/**
 * Parses Git's pre-push stdin payload into structured ref updates.
 *
 * Git pipes one line per pushed ref, of the form:
 *   <local-ref> SP <local-sha> SP <remote-ref> SP <remote-sha> LF
 * Multiple lines are pushed for multi-ref pushes (e.g. `git push --all`).
 * Malformed lines (fewer than 4 fields) are skipped rather than throwing.
 */
export function parseRefLines(stdin: string): RefUpdate[] {
  return stdin
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 4) return null;
      const [localRef, localSha, remoteRef, remoteSha] = parts as [string, string, string, string];
      return { localRef, localSha, remoteRef, remoteSha };
    })
    .filter((ref): ref is RefUpdate => ref !== null);
}

/**
 * Extracts the raw unified diff of commits being pushed.
 *
 * In pre-push mode, Git pipes stdin ref-pair lines (see `parseRefLines`).
 * Each ref line is diffed independently and the results are concatenated
 * — a single push can update multiple refs (e.g. multiple branches/tags).
 * Deleted refs (local SHA all-zero) are skipped: there is nothing to scan
 * when a ref is being removed. New branches (remote SHA all-zero) are
 * diffed against the empty tree. Falls back to common diff strategies for
 * manual scans when stdin is absent/empty/unusable.
 */
export async function getDiff(stdin?: string): Promise<string> {
  if (stdin?.trim()) {
    const refs = parseRefLines(stdin);
    const diffs: string[] = [];

    for (const ref of refs) {
      if (ZERO_SHA.test(ref.localSha)) {
        // Deleted ref — nothing to scan.
        continue;
      }

      const isNewBranch = ZERO_SHA.test(ref.remoteSha);
      // The empty-tree SHA is a tree object, not a commit, so triple-dot
      // (symmetric difference) is invalid against it — use two-dot instead.
      const range = isNewBranch
        ? `${EMPTY_TREE}..${ref.localSha}`
        : `${ref.remoteSha}...${ref.localSha}`;

      try {
        const { stdout } = await execa("git", ["diff", "--unified=3", range]);
        if (stdout) diffs.push(stdout);
      } catch {}
    }

    if (diffs.length > 0) return diffs.join("\n");
    // Ref lines were present and understood (even if all were deletions or
    // produced no diff) — there is genuinely nothing to scan, don't fall
    // through to the manual working-tree fallbacks below.
    if (refs.length > 0) return "";
  }

  // Manual scan fallbacks. Prefer the current working tree/staged diff
  // before falling back to committed ranges.
  for (const args of [
    ["diff", "--unified=3", "HEAD"],
    ["diff", "--unified=3", "origin/main...HEAD"],
    ["diff", "--unified=3", "HEAD~1..HEAD"],
  ]) {
    try {
      const { stdout } = await execa("git", args);
      if (stdout) return stdout;
    } catch {}
  }

  return "";
}
