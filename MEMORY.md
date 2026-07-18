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
