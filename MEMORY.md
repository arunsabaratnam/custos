# MEMORY.md

This file is the running implementation memory for Custos. Update it before any commit, push, or handoff of commit-ready work.

Each entry should include:

- Summary: what changed and why.
- Affected files: important files touched.
- Functionality: user-visible behavior or internal flow changes.
- Imports/dependencies: notable imports, package changes, or dependency usage.
- Verification: tests, builds, or manual checks run.
- Follow-ups: anything a future agent should remember.

## 2026-07-18 — Welcome screen redesign and interactive launcher

- Summary: Reworked the `custos` welcome screen to feel more like a polished terminal product: larger logo, wider responsive box, monochrome styling, and a keyboard-navigable action menu.
- Affected files: `src/commands/welcome.ts`, `test/cli.test.ts`, generated `dist` output after `npm run build`.
- Functionality: Running `custos` in an interactive TTY now shows a large ASCII Custos logo, expands the box width based on terminal columns, and allows up/down + Enter selection for `custos init`, `custos scan`, `custos doctor`, `custos audit`, `custos help`, or exit. Non-interactive runs still print static output so tests and scripts do not hang.
- Imports/dependencies: Added Node `readline` usage in `src/commands/welcome.ts` and reused existing command runners: `runInit`, `runScan`, `runDoctor`, `runAudit`, and `runHelp`. No package dependencies added.
- Verification: Ran `npm run typecheck`, `npm test`, `npm run build`, and manually launched the linked `custos` binary in a TTY to confirm the wider box and interactive menu render.
- Follow-ups: If the welcome menu needs richer styling later, keep it monochrome unless the product direction changes. Avoid introducing prompt libraries with fixed brand colors for this surface.

## 2026-07-18 — Static welcome and select command split

- Summary: Restored `custos` as a fast static welcome screen so users return directly to their shell prompt, moved the keyboard launcher into a dedicated `custos select` command, and changed the Custos title to a filled white block wordmark.
- Affected files: `src/commands/welcome.ts`, `src/commands/select.ts`, `src/cli.ts`, `src/commands/help.ts`, `test/cli.test.ts`, generated `dist` output after `npm run build`.
- Functionality: The welcome screen now lists `Navigate commands custos select` in Getting Started and no longer opens the arrow-key menu automatically. `custos select` opens the navigable command launcher with options for init, scan, doctor, audit, help, and exit.
- Imports/dependencies: Removed `readline` and command-runner imports from `src/commands/welcome.ts`; added `src/commands/select.ts` with Node `readline` plus existing command runner imports. No package dependencies added.
- Verification: Ran `npm run typecheck`, reran `npm test` outside the sandbox due to `tsx` IPC restrictions, ran `npm run build`, launched linked `custos` to verify it returns immediately, and launched `custos select` in a TTY to verify the keyboard menu renders.
- Follow-ups: If the command launcher gets more options, keep the default `custos` path non-blocking so it never captures normal shell input.

## 2026-07-18 — Command-first welcome rows

- Summary: Refactored the welcome screen Getting Started area so executable commands appear on the left and descriptions appear on the right for faster scanning.
- Affected files: `src/commands/welcome.ts`, `MEMORY.md`.
- Functionality: `custos` now displays rows like `custos init Initialize repo`, `custos scan Run a scan`, `custos doctor Check setup`, and `custos select Navigate commands`; the footer hint also leads with `custos select`.
- Imports/dependencies: Added a local `commandRow` formatter in `src/commands/welcome.ts`; no imports or dependencies changed.
- Verification: Pending final render/checks in this change set.
- Follow-ups: Keep welcome rows command-first if more Getting Started commands are added.

## 2026-07-18 — Implement `custos scan` core loop (runScan orchestration)

- Summary: Replaced the `custos scan` stub with the full Phase 1, Task 4 orchestration: reads Git pre-push stdin ref-pairs, extracts/parses the outgoing diff, runs the scanner, renders findings, resolves config precedence, drives the interactive action menu (abort/view details/apply patch/override), and enforces exit codes. Also fixed a real multi-ref/deleted-ref bug in `getDiff`, and added an animated "Checkpoint" terminal presentation (gradient banner, step-specific spinners).
- Affected files: `src/commands/scan.ts` (full rewrite), `src/git/getDiff.ts` (multi-line stdin parsing, deleted-ref skip, new-branch/empty-tree handling, diff union across refs), `src/commands/repoState.ts` (added `patchFormat: "replace" | "diff"` to `RepoConfig`, default `"replace"`), `src/ui/prompts.ts` (added `promptConfirm` helper), `src/ui/spinner.ts` (new — `ora`-based `withSpinner`/`startElapsedSpinner` with per-step frame sets), `src/ui/banner.ts` (new — `gradient-string` startup banner, skipped for non-TTY/`--json`), `.custos/config.json` (added `patchFormat`), `test/git/getDiff.test.ts` (new multi-ref/deleted-ref/malformed-line cases), `test/commands/scan.test.ts` (new — 15 integration tests covering the full state machine).
- Functionality: `custos scan --pre-push` now fully drains Git's ref-pair stdin (handling multiple refs, new branches via empty-tree diff, and deleted refs by skipping them), unions diffs across refs, and never hangs. No findings or low/medium-only findings allow the push (exit 0) with a concise message; critical/high findings render and enter an interactive menu. `.custos/config.json`'s `blockingThreshold`/`ai.enabled`/`audit.enabled`/`patchFormat` take precedence over `CUSTOS_BLOCK_ON`/`CUSTOS_AI_PATCHES`/`CUSTOS_AUDIT_ENABLED` env vars whenever the config file exists; env vars remain the fallback. Apply-patch does a path-safe, shell-free string replacement of the matched evidence, previews before confirming, and always exits 1 after writing. Override runs the Auth0 device flow, and if the MongoDB audit write fails, now prompts the user to explicitly confirm continuing unlogged (confirm → exit 0, decline → exit 1) instead of silently allowing or blocking. When `--pre-push` stdin isn't a TTY, Custos attempts to reopen `/dev/tty` for interactive prompts (mirroring husky's `exec < /dev/tty` fix for the same Git stdin/TTY conflict); if that fails (Windows, CI, no controlling terminal), it renders manual-fix guidance and blocks instead of hanging. `--json` now always prints valid JSON (including `[]`) instead of skipping output on the no-findings path.
- Imports/dependencies: Added `gradient-string` to `package.json`/`package-lock.json` for the startup banner. Reused existing `ora`, `chalk`, `@clack/prompts`, `execa`, `boxen` dependencies; no other new packages. `scan.ts` now imports from `node:fs`, `node:fs/promises`, `node:path`, `node:tty` for the `/dev/tty` reopen and safe patch-file writes.
- Verification: `npm run typecheck`, `npm run lint`, and `npm test` all pass (48/48 tests, up from 30). Manually ran `npx tsx src/cli.ts scan`, `scan --json` (stdout-only, confirmed clean `[]`/JSON), and `scan --pre-push` with empty stdin — all exit 0 without crashing against the real (still rule-stubbed) scanner. Verified `git status` had no stray artifacts after test runs.
- Follow-ups: `src/scanner/rules.ts` and `src/ai/prompts.ts` remain human-owned stubs — real findings won't appear until those are filled in, so the interactive action-menu paths are currently only exercised by the new `test/commands/scan.test.ts` mocks, not a live demo repo yet. `src/ai/backboardClient.ts`, `src/auth/deviceFlow.ts`, `src/auth/claimsBuilder.ts`, and `src/audit/mongo.ts`/`writeAudit.ts` are still later-phase stubs that throw — `runScan` degrades gracefully around them today, but the Auth0/Mongo/Backboard demo paths need those implemented before the live judge demo. `patchFormat: "diff"` is accepted in config but not implemented — it currently falls back to `"replace"` with a stderr note.

## 2026-07-18 — Mandate custos-testing sandbox verification before every push

- Summary: Added a required pre-push verification step to `AGENTS.md`'s Agent Collaboration Notes: rebuild `dist/` and exercise the real pre-push hook end-to-end against the dedicated sandbox repo `arunsabaratnam/custos-testing` before pushing to this repository. Cloned that sandbox locally and ran it once to confirm the current `runScan` implementation works through a real `git push`.
- Affected files: `AGENTS.MD` (new bullet in Agent Collaboration Notes), `MEMORY.md`. No `src/` changes in this entry.
- Functionality: No product behavior changed. Process change only — future agents must verify against `custos-testing` (cloned as a sibling directory of this project) before pushing, not just run unit tests.
- Imports/dependencies: None.
- Verification: Cloned `https://github.com/arunsabaratnam/custos-testing` as a sibling directory. Ran `npm run build` in this repo so the linked `custos` binary picked up the latest `src/` changes. In `custos-testing`: ran `custos init` (installed the pre-push hook + `.custos/config.json`), `custos scan` (clean, exit 0), committed a small demo file, and ran a real `git push origin main` — the pre-push hook fired, the animated spinner and "No security issues detected." rendered, the hook exited 0, and the push completed successfully against GitHub.
- Follow-ups: Keep `custos-testing` as the standing sandbox for future hook verification; once `src/scanner/rules.ts` has real rules, add a vulnerable-code commit there to verify the blocking/action-menu path too, not just the clean-scan path.
