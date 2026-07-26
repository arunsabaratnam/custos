# MEMORY.md

This file is the running implementation memory for Custos. Update it before any commit, push, or handoff of commit-ready work.

Each entry should include:

- Summary: what changed and why.
- Affected files: important files touched.
- Functionality: user-visible behavior or internal flow changes.
- Imports/dependencies: notable imports, package changes, or dependency usage.
- Verification: tests, builds, or manual checks run.
- Follow-ups: anything a future agent should remember.

## 2026-07-18 — Make `custos scan` work end-to-end (all integrations + real rules/prompts)

- Summary: Implemented every stubbed module the scan loop depends on so `custos scan` is genuinely functional, not just plumbing that no-ops. **Scope note:** the user explicitly overrode AGENTS.MD's "human-owned" boundary and authorized editing `src/scanner/rules.ts` and `src/ai/prompts.ts` — both are now implemented. Also fixed two real gaps found during the work (dotenv never loaded; hook could hang once Mongo keeps the event loop alive) and hardened the AI severity path.
- Affected files: `src/scanner/rules.ts` (9 real detection rules, was all-null stubs), `src/ai/prompts.ts` (model selection + explain/patch system prompts, env-overridable), `src/ai/backboardClient.ts` (real `fetch` client + defensive JSON-envelope extraction + zod validation), `src/audit/mongo.ts` (memoized connect w/ 5s timeout, safe disconnect), `src/audit/writeAudit.ts` (lazy connect + repo-metadata enrichment + `listAuditEvents`), `src/auth/claimsBuilder.ts` (`buildFindingContext`), `src/auth/deviceFlow.ts` (device-code request + token polling w/ slow_down/timeout + base64url JWT decode), `src/cli.ts` (`import "dotenv/config"` + teardown `finally` that disconnects Mongo and `process.exit`s), `src/commands/scan.ts` (AI can raise but never lower severity via `maxSeverity`; merge `buildFindingContext` into `jwtClaims` on override). Tests: rewrote `test/scanner.test.ts` (stub-null assertions → real detection), added `test/auth/claimsBuilder.test.ts`, `test/ai/backboardClient.test.ts`, `test/audit/writeAudit.test.ts`.
- Functionality: Scanner now detects hardcoded API keys (critical, incl. the demo `sk-demo-leaked-key` — pattern tolerant of hyphen groups), hardcoded secrets (high), private keys (critical), committed `.env` (high), SQL injection (critical, w/ parameterized patch), eval/new Function (high), dangerous exec (high), wildcard CORS+credentials (medium), prompt-injection sinks (medium). Secret/API-key rules emit a `process.env.X` patch so apply-patch works with **zero Backboard dependency**. Backboard is a soft dependency: missing key / bad JSON throws → scan.ts falls back to the deterministic finding. MongoDB writes enrich `repoName`/`repoPathHash(sha256)`/`branch`/`commitSha` and fail fast + graceful when `MONGODB_URI` unset. Auth0 override embeds finding context into the device request and always writes that context into the audit ledger even if the token strips the `https://custos/*` claims.
- Imports/dependencies: No new packages. Uses native `fetch` (Node 18+), `node:crypto`, `Buffer.from(..., "base64url")`, existing `mongoose`/`execa`/`zod`/`dotenv`.
- Verification: `npm run typecheck`, `npm run lint`, `npm run build` all clean; `npm test` 59/59 (was 48). Sandbox (`custos-testing`) real pre-push simulation with piped ref-pair stdin: critical vuln → rendered finding + **exit 1 (blocked), no hang**; benign change → "No security issues detected." + exit 0; both degraded gracefully on missing `MONGODB_URI`. Sandbox left clean (reset to origin/main).
- Follow-ups: User still must supply external services for the full demo — `MONGODB_URI` (audit ledger + future `custos audit`), `BACKBOARD_API_KEY` (+ optional `CUSTOS_EXPLAIN_MODEL`/`CUSTOS_PATCH_MODEL`) for AI, and Auth0 (`AUTH0_DOMAIN`/`CLIENT_ID`/`AUDIENCE` + a deployed post-login Action that reads finding context and sets `https://custos/*` claims; only the user can confirm the claims survive the device-flow round-trip in their tenant). `custos audit`/`custos doctor` command bodies remain stubs (kept scan-only per user). `patchFormat: "diff"` still falls back to "replace". See global memory [[custos-rules-prompts-now-agent-owned]].

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

## 2026-07-18 — Purple accent for title and commands

- Summary: Introduced the `#E0B0FF` accent color for the Custos title and executable command text while keeping supporting copy, status labels, borders, and help text white.
- Affected files: `src/commands/welcome.ts`, `src/commands/select.ts`, `MEMORY.md`.
- Functionality: The welcome screen logo, Getting Started commands, and footer command now render purple. The `custos select` launcher title, pointer, and command hints also use the same purple accent.
- Imports/dependencies: Reused existing `chalk.hex("#E0B0FF")`; no imports or package dependencies changed.
- Verification: Ran `npm run typecheck`, `npm test`, `npm run build`, rendered linked `custos` in a TTY, and launched `custos select` in a TTY to verify purple title/commands with white supporting text.
- Follow-ups: Revisit contrast after broader theme decisions, especially if the terminal background is not dark.

## 2026-07-18 — Purple border and strict welcome contrast

- Summary: Tightened the welcome/select CLI theme so the welcome border is purple, all non-accent text is white, and bold styling is limited to the requested welcome copy, section headings, and white fallback status values.
- Affected files: `src/commands/welcome.ts`, `src/commands/select.ts`, `MEMORY.md`.
- Functionality: `custos` now renders the box border, logo, commands, footer command, and positive status values (`yes`, `enabled`, `installed`) in `#E0B0FF`. Supporting text is white; unavailable/negative statuses render bold white.
- Imports/dependencies: Reused the existing local `accent` helper based on `chalk.hex("#E0B0FF")`; no imports or package dependencies changed.
- Verification: Ran `npm run typecheck`, `npm test`, `npm run build`, rendered linked `custos` in a TTY, and launched `custos select` in a TTY to confirm purple border/title/commands/positive statuses with white supporting text.
- Follow-ups: Keep this screen to a two-color palette unless the user explicitly changes the theme direction.

## 2026-07-26 — Scan UI wording and lavender banner

- Summary: Made the blocking scan action menu context-aware and aligned the scan banner with the welcome screen's lavender brand accent.
- Affected files: `src/commands/scan.ts`, `src/ui/prompts.ts`, `src/ui/banner.ts`, `test/commands/scan.test.ts`, `test/ui/prompts.test.ts`, `test/auth/deviceFlow.test.ts`, `MEMORY.md`.
- Functionality: Plain `custos scan` now says `Custos blocked this scan`, labels the abort action `Exit scan`, and exits with `Scan exited.`; `custos scan --pre-push` keeps push-specific wording (`Custos blocked this push`, `Abort push`, `Push aborted.`). The `c u s t o s` scan banner now uses a lavender gradient centered on `#E0B0FF` with a pale shimmer highlight instead of the old red/amber styling. Added a regression test for the Auth0 override configuration error spacing.
- Imports/dependencies: No new imports or dependencies.
- Verification: Ran `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` (outside the sandbox for subprocess `tsx` IPC access). Ran required sandbox verification via a temporary worktree from sibling `custos-testing`: `custos init`, committed benign `codex-ui-verification.txt`, and pushed `HEAD:refs/heads/codex/verify-ui-scan`; pre-push hook ran `custos scan --pre-push`, reported "No security issues detected.", skipped audit because `MONGODB_URI` is unset, and push succeeded.
- Follow-ups: The real pre-push action-menu navigability issue is intentionally not addressed in this change set; user asked to handle that later.

## 2026-07-26 — Make pre-push prompts navigable from Git hooks

- Summary: Fixed the pre-push action menu so `@clack/prompts` receives real TTY input instead of Git's exhausted ref-update stdin.
- Affected files: `src/commands/repoState.ts`, `src/commands/scan.ts`, `test/commands/init.test.ts`, `test/commands/scan.test.ts`, `MEMORY.md`.
- Functionality: `custos init` now installs a pre-push block that saves Git's stdin ref lines to a temp file, runs `custos scan --pre-push` with `CUSTOS_PRE_PUSH_STDIN_FILE` set, and redirects stdin from `/dev/tty` only when the shell can actually open it. If `/dev/tty` is unavailable (for example non-interactive command runners), the hook falls back to non-TTY scan mode instead of failing with `Device not configured`. `runScan` reads that temp file first and falls back to legacy piped stdin for older hooks. Prompt helpers are now dynamically imported only after interactive stdin is ready, so old hooks using the `/dev/tty` rebind path are also covered.
- Imports/dependencies: No new packages. Continued use of existing `node:fs/promises`, `node:tty`, and dynamic `import("../ui/prompts.js")` / `import("@clack/prompts")`.
- Verification: Ran `npm run typecheck`, `npm run lint`, `npm run build`, full `npm test` (68 tests), and a real PTY `git push` in a temporary `custos-testing` worktree with a vulnerable commit. Sent Down+Enter to the prompt; selection moved to `View technical details`, evidence printed, and the push was blocked with `failed to push some refs`.
- Follow-ups: Existing repos need `custos init` once to rewrite the installed pre-push hook to the new temp-file/TTY wrapper.

## 2026-07-26 — Implement MongoDB audit log viewer

- Summary: Implemented `custos audit` as the terminal history view for MongoDB audit events and aligned scan audit actions with the actual allow/block decision.
- Affected files: `src/commands/audit.ts`, `src/cli.ts`, `src/audit/model.ts`, `src/commands/scan.ts`, `test/commands/audit.test.ts`, `test/commands/scan.test.ts`, `MEMORY.md`.
- Functionality: `custos audit` now fetches recent events from MongoDB via `listAuditEvents`, formats them newest-first in a compact git-log-style block, and uses a built-in TTY pager with `q` to quit, arrow/j/k scrolling, and page up/down. `custos audit --no-pager` prints all output directly; `--limit` controls the number of events. Audit records show commit, repo hash, branch, user, action, event type, finding details, override reason, and important Auth0/JWT claims. Warning-level findings now write audit action `allowed` instead of incorrectly recording `blocked`.
- Imports/dependencies: Added `node:readline` usage in `src/commands/audit.ts`; no package dependencies added. Added Mongo indexes for `createdAt`, repo/branch/time, and eventType/time.
- Verification: Ran focused `npm test -- --run test/commands/audit.test.ts test/audit/writeAudit.test.ts test/commands/scan.test.ts` and `npm run typecheck`. Live Atlas verification still requires local `.env` secrets (`MONGODB_URI`, `MONGODB_DB`, `CUSTOS_AUDIT_ENABLED`) and should not commit `.env`.
- Follow-ups: Implement `custos doctor` MongoDB connectivity checks next, and decide whether Auth0 overrides should be hard-blocked when the Mongo audit write fails.

## 2026-07-26 — Keep scan details in-flow and add audit table

- Summary: Fixed the scan action menu so viewing technical details returns to the menu instead of ending the flow, and added a compact table mode for `custos audit`.
- Affected files: `src/commands/scan.ts`, `src/ui/prompts.ts`, `src/ui/renderFinding.ts`, `src/ui/theme.ts`, `src/commands/audit.ts`, `src/cli.ts`, `test/commands/scan.test.ts`, `test/ui/prompts.test.ts`, `test/commands/audit.test.ts`, `MEMORY.md`.
- Functionality: `View technical details` now prints rule/severity/category/source/file/evidence/recommendation/patch information, waits for the user to return, then shows the same action menu again. The custom action menu uses the welcome-screen lavender accent for its rail and active marker. Finding locations inside rendered finding boxes now use the same lavender file color. `custos audit --table` renders a horizontal table with lavender title/header/divider, white normal cells, and severity-colored priority cells; default `custos audit` remains the detailed log view.
- Imports/dependencies: Added shared `accentHex`/`accent` exports in `src/ui/theme.ts`; no package dependencies added.
- Verification: Ran `npm run typecheck`, `npm run lint`, `npm run build`, and focused `npm test -- --run test/ui/prompts.test.ts test/commands/scan.test.ts test/commands/audit.test.ts`.
- Follow-ups: If the table needs live column resizing for very narrow terminals, add terminal-width-aware column sets; current table truncates long cells with an ellipsis.

## 2026-07-26 — Box audit output and simplify wide tables

- Summary: Refined audit rendering so regular audit entries are boxed individually and table mode stays clean without an external pager.
- Affected files: `src/commands/audit.ts`, `test/commands/audit.test.ts`, `MEMORY.md`.
- Functionality: Regular `custos audit` now renders each event inside its own lavender bordered block for easier scanning. `custos audit --table` keeps the wide spaced table, moves `Commit` to the leftmost column, removes the external `less` pager that produced `~` filler rows and right-edge markers, and prints with terminal line wrapping temporarily disabled so the table remains a single clean wide block.
- Imports/dependencies: Reused existing `readline`, `chalk`, and shared `accent` helpers; no imports or package dependencies added.
- Verification: Ran `npm run typecheck`, focused `npm test -- --run test/commands/audit.test.ts`, `npm run lint`, `npm run build`, and full `npm test` outside the sandbox because sandboxed `tsx` subprocess IPC failed with `listen EPERM` on `/var/folders/.../tsx-501/*.pipe`.
- Follow-ups: Horizontal trackpad scrolling depends on terminal support for wide scrollback; this implementation avoids pager artifacts and preserves a clean table in the normal terminal buffer.

## 2026-07-26 — Gate Auth0 overrides behind user config

- Summary: Made Auth0 override an explicit opt-in setting and added Auth0 readiness checks to `custos doctor`.
- Affected files: `src/commands/repoState.ts`, `src/commands/scan.ts`, `src/ui/prompts.ts`, `src/auth/deviceFlow.ts`, `src/commands/doctor.ts`, `.env.example`, `test/commands/scan.test.ts`, `test/ui/prompts.test.ts`, `test/auth/deviceFlow.test.ts`, `test/commands/init.test.ts`, `test/commands/doctor.test.ts`, `MEMORY.md`.
- Functionality: New repo configs include `auth: { enabled: false, provider: "auth0" }`. The scan action menu only shows `Force override with Auth0` when Auth0 override is enabled and `AUTH0_DOMAIN` plus `AUTH0_CLIENT_ID` are configured. Override can be enabled through repo config or `CUSTOS_ALLOW_OVERRIDE=true`; `.env.example` keeps it disabled by default. `custos doctor` now reports whether Auth0 override is enabled, verifies required Auth0 variables only when enabled, omits optional `AUTH0_AUDIENCE` unless configured, uses purple checkmarks for passing checks, and notes that `AUTH0_CLIENT_SECRET` is not used by the CLI Device Authorization Flow. Device-code requests now send only Auth0-supported parameters (`client_id`, `scope`, optional `audience`) instead of attempting to pass finding context through unsupported fields; missing Device Code grant errors now point users to Auth0 Advanced Settings > Grant Types.
- Imports/dependencies: Added `execa`/`chalk`/`accent` imports to `src/commands/doctor.ts`; no package dependencies added.
- Verification: Ran `npm run typecheck`, `npm run lint`, `npm run build`, and full `npm test` outside the sandbox because sandboxed `tsx` subprocess IPC failed with `listen EPERM` on `/var/folders/.../tsx-501/*.pipe`.
- Follow-ups: Auth0 custom JWT claims for finding context would require a separate supported handoff mechanism; current implementation stores finding context reliably in Mongo audit events and uses Auth0 tokens for identity verification.

## 2026-07-26 — Keep manual scan actions non-terminal until exit

- Summary: Hid Auth0 override from plain `custos scan`, kept declined patch previews inside the action menu, and made secondary prompts use the same lavender navigation styling as the main scan menu.
- Affected files: `src/commands/scan.ts`, `src/ui/prompts.ts`, `test/commands/scan.test.ts`, `MEMORY.md`.
- Functionality: `Force override with Auth0` is now only offered during `custos scan --pre-push` when Auth0 override is configured; manual scans cannot override because no push is being allowed. Declining `Apply suggested patch` now returns to the navigable action menu instead of ending the scan. `View technical details` still returns to the menu, and the return prompt, patch confirmation, and override reason prompt now render with the shared `#E0B0FF` rail/diamond instead of Clack's default blue markers.
- Imports/dependencies: Removed `@clack/prompts` usage from `src/ui/prompts.ts` in favor of local `readline`-based prompt helpers; no package dependencies changed.
- Verification: Ran `npm run typecheck`, `npm run lint`, `npm run build`, focused `npm test -- --run test/commands/scan.test.ts test/ui/prompts.test.ts`, and full `npm test` outside the sandbox because the CLI subprocess tests need `tsx` IPC pipes.
- Follow-ups: Manual interactive visual QA in a real terminal is still useful before demo because prompt rendering depends on terminal behavior.

## 2026-07-26 — Add multi-issue scan navigation

- Summary: Added a first-level issue picker for scans with multiple blocking findings and clarified patch availability around deterministic and AI-generated fixes.
- Affected files: `src/commands/scan.ts`, `src/ui/prompts.ts`, `test/commands/scan.test.ts`, `test/ui/prompts.test.ts`, `MEMORY.md`.
- Functionality: When more than one blocking issue exists, Custos now prompts `Which issue do you want to analyze?` with severity-colored issue rows and the shared lavender navigation rail. Selecting an issue opens the existing action menu for that specific finding. The action menu includes `Back to issues` in multi-issue mode, while `Exit scan` / `Abort push` remains the only terminal quit action. Patch application now targets the selected finding's `file` and `evidence`. The patch action is available when a finding already has a deterministic patch or when Backboard AI patching is configured and a matching diff hunk exists.
- Imports/dependencies: `src/ui/prompts.ts` now imports `Finding` for issue rendering and `severityColor` for severity-colored issue rows; no package dependencies changed.
- Verification: Ran `npm run typecheck`, `npm run lint`, `npm run build`, focused `npm test -- --run test/commands/scan.test.ts test/ui/prompts.test.ts`, and full `npm test` outside the sandbox because sandboxed CLI subprocess tests hit `tsx` IPC `listen EPERM`.
- Follow-ups: Manually exercise a real terminal scan with two different findings before demo to tune wording and spacing if needed.
