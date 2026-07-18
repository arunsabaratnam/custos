/**
 * `custos init` — installs Custos into the current Git repository.
 *
 * Not implemented yet. Future behavior (AGENTS.md "custos init"):
 * verify inside a Git repo, ensure .git/hooks exists, write/update
 * .git/hooks/pre-push to call `custos scan --pre-push`, preserve existing
 * hook content, make it executable, print what was installed.
 *
 * IMPORTANT: the pre-push hook must never be installed or enabled by this
 * stub. That wiring is deferred to a later phase.
 */
export async function runInit(): Promise<void> {
  console.log("custos init: not implemented yet.");
}
