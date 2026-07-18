# AGENTS.MD

This file is the operating guide for agents working on Custos. Treat it as the authoritative product, architecture, and implementation context. If future decisions conflict with this file, prefer the smallest change that preserves the core demo loop and update this file with the new reasoning.

## Project Context

Custos is being built for Hack the 6ix 2026, a hackathon running July 17-19, 2026. A Devpost draft submission is required by 11:59pm on Saturday, July 18.

Judging criteria:

- **Technical difficulty**: How hard was the project to build, and how much of the heavy lifting did the team implement?
- **Uniqueness**: Is the project meaningfully original, or just a common hackathon pattern with AI added?
- **Design**: Is the user experience intuitive, polished, and appropriate for the target user?
- **Completeness**: Does the project work end to end, with a clear demo and finished core flow?

Custos should be optimized for a strong live demo. The goal is not to build a production-grade security company in a weekend. The goal is to build a focused, credible, technically interesting developer-security workflow that judges can understand quickly.

## Product Summary

Custos is a terminal-native, local-first developer security sidekick.

It performs "extreme shift left" security by scanning code before it leaves the developer's machine. Instead of waiting for cloud CI scans, PR reviews, or asynchronous security dashboards, Custos intercepts dangerous code at the moment a developer tries to push it.

The central product claim:

> Security tools usually warn you after code reaches GitHub. Custos stops risky code at the terminal before it ever leaves the laptop.

## Core Demo Loop

This loop must be reliable before optional features are added:

1. The user runs `custos init`.
2. Custos installs a local Git `pre-push` hook.
3. The user commits vulnerable code.
4. The user runs `git push`.
5. The hook invokes `custos scan --pre-push`.
6. Custos extracts the outgoing Git diff.
7. Custos runs deterministic local rules against the changed lines.
8. Custos detects a security finding.
9. Custos displays a clear terminal explanation.
10. Custos offers actions:
    - Apply suggested patch
    - View details
    - Force override with Auth0
    - Abort push
11. If the user applies the patch, Custos edits the source file and exits with a blocking status so the user can review and recommit.
12. If the user overrides, Custos performs Auth0 Device Authorization Flow, embeds finding context into the issued JWT via a post-login Action, logs the event to MongoDB Atlas, and allows the push.
13. If no high-risk findings exist, Custos allows the push silently.

## Module Ownership

Agents are responsible for scaffolding and wiring all plumbing. The human developer owns the business logic files. This distinction must be preserved.

### Agent-owned (scaffold and wire fully):

- CLI entry point and command routing
- Git diff extraction and diff parsing
- `Finding` type, `DiffHunk` type, severity model
- Terminal UI rendering (boxes, colors, action menus)
- Backboard HTTP client — both the explain call and the patch call
- Auth0 Device Flow polling, post-login Action setup, JWT claim extraction
- MongoDB connection, `AuditEvent` model, write and read operations
- `custos doctor` environment checks
- Exit code enforcement (0 = allow, 1 = block)
- Graceful fallback when any integration is unavailable

### Human-owned (leave as stubs with clear interfaces):

- `src/scanner/rules.ts` — the regex patterns and heuristics that detect vulnerabilities
- `src/ai/prompts.ts` — the system prompts sent to Backboard for explanation and patch generation, and the model selection per call

Do not implement scanner rules or AI prompts speculatively. Scaffold the interfaces, leave stub implementations, and document what the human needs to fill in.

## Target Sponsor Tracks

### Warp: Best Developer Tool

Custos is primarily a developer tool. The Warp story:

- Terminal-native workflow.
- Clean interactive CLI UX.
- Fast feedback before `git push` completes.
- Developer productivity and safety.
- Optional MCP integration so terminal agents can inspect Custos findings.

Do not make a web dashboard the center of the project. The terminal is the product surface.

### Backboard.io: Most Innovative Use

Backboard is used as a cost-aware, latency-aware AI routing layer — not a simple LLM API call.

The intended story:

- A fast, cheap model is used to triage and explain findings.
- A stronger model is invoked only when patch generation is needed.
- Custos sends minimal, relevant code snippets rather than entire repositories.
- AI enriches deterministic findings — it is never a dependency for blocking.

See the Backboard Integration section for implementation details.

### Auth0: Best Use of Auth0

Auth0 powers cryptographically accountable CLI overrides. The story is intentionally more than "log in before you push."

The intended story:

> Most overrides are anonymous or just password-gated. With Custos, when you override a critical finding, Auth0 issues a token that names the exact vulnerability, file, commit, and your identity. The JWT is the signed record of accountability.

Auth0 is a **cryptographic witness**, not just a gatekeeper. See the Auth0 Integration section for implementation details.

### MongoDB Atlas: Best Use of MongoDB Atlas

MongoDB Atlas stores the audit ledger. The intended story:

- Security findings and overrides are not ephemeral terminal messages.
- Custos stores structured, queryable audit events.
- Each record contains repo metadata, branch, commit, finding severity, user identity, override reason, timestamp, and action.
- Judges can see proof that risky decisions are tracked.

The minimal interface is `custos audit`. A web dashboard is optional and lower priority.

## Architecture Overview

Custos is structured in two layers built in sequence:

**Layer 1 — Core Loop** (built first, must work end-to-end before integrations):

```
git push
  → pre-push hook
    → custos scan --pre-push
      → extract Git diff
        → parse into DiffHunk[]
          → run local scanner rules → Finding[]
            → if empty: exit 0 (silent allow)
            → render findings in terminal
              → if no critical/high: exit 0 (warn only)
              → show action menu
                → apply patch: write file, exit 1
                → abort: exit 1
                → override: Auth0 flow → MongoDB write → exit 0
```

**Layer 2 — Integration slices** (added independently after Layer 1 works):

- Backboard AI enrichment (explain + patch generation)
- Auth0 Device Flow + JWT claims
- MongoDB audit writes and reads

**Two invariants that must always hold:**

1. The hook never crashes. Every integration failure is caught, logged to stderr, and falls back gracefully. A missing `BACKBOARD_API_KEY` skips AI enrichment. A missing `MONGODB_URI` warns and continues.
2. A patch applied by Custos always exits 1. Custos never silently patches and allows the same push.

## File Structure

```
custos/
├── src/
│   ├── cli.ts                    # Entry point, commander setup, command registration
│   │
│   ├── commands/
│   │   ├── init.ts               # custos init — installs pre-push hook
│   │   ├── scan.ts               # custos scan — orchestrates the full loop
│   │   ├── audit.ts              # custos audit — reads and renders MongoDB events
│   │   └── doctor.ts             # custos doctor — validates environment
│   │
│   ├── git/
│   │   ├── getDiff.ts            # Extracts commits being pushed → raw diff string
│   │   └── parseDiff.ts          # Parses raw diff → DiffHunk[]
│   │
│   ├── scanner/
│   │   ├── rules.ts              # HUMAN-OWNED: rule definitions, stubs provided
│   │   ├── scanDiff.ts           # Runs all rules against all hunks → Finding[]
│   │   └── types.ts              # Finding, DiffHunk, Severity, RuleMatch types
│   │
│   ├── ai/
│   │   ├── backboardClient.ts    # Backboard HTTP client — explain call + patch call
│   │   ├── prompts.ts            # HUMAN-OWNED: system prompts and model selection
│   │   └── schemas.ts            # Zod schemas for Backboard responses
│   │
│   ├── auth/
│   │   ├── deviceFlow.ts         # Auth0 Device Authorization Flow + polling
│   │   └── claimsBuilder.ts      # Builds finding context object for JWT claims
│   │
│   ├── audit/
│   │   ├── mongo.ts              # MongoDB connection management
│   │   ├── model.ts              # AuditEvent mongoose schema
│   │   └── writeAudit.ts         # writeAuditEvent() and listAuditEvents()
│   │
│   └── ui/
│       ├── renderFinding.ts      # Renders a single Finding to terminal
│       ├── prompts.ts            # Action menu (clack), override reason prompt
│       └── theme.ts              # Chalk color scheme and boxen styles
│
├── .env.example
├── package.json
└── tsconfig.json
```

## Core Types

All scanner outputs normalize to `Finding`. All integrations consume `Finding`.

```ts
type Severity = "low" | "medium" | "high" | "critical";

type Finding = {
  id: string;
  severity: Severity;
  category: "secret" | "injection" | "auth" | "dependency" | "ai-safety";
  title: string;
  file: string;
  line?: number;
  evidence: string;        // the matched line or snippet
  explanation: string;     // plain-language description (AI-enriched or rule default)
  recommendation: string;  // what to do (AI-enriched or rule default)
  patch?: string;          // suggested code fix, if generated
  source: "rule" | "ai" | "hybrid";
};

type DiffHunk = {
  file: string;
  language: string;
  addedLines: Array<{ line: number; content: string }>;
  context: string;         // surrounding lines for AI context
};

type AuditEvent = {
  eventType:
    | "scan_passed"
    | "finding_detected"
    | "finding_blocked"
    | "patch_applied"
    | "override_requested"
    | "override_approved"
    | "override_denied";
  repoName: string;
  repoPathHash: string;
  branch?: string;
  commitSha?: string;
  userId?: string;
  userEmail?: string;
  finding?: Finding;
  overrideReason?: string;
  jwtClaims?: Record<string, unknown>; // decoded claims from Auth0 token
  action: "allowed" | "blocked" | "patched" | "overridden";
  createdAt: Date;
};
```

## CLI Commands

### `custos init`

Installs Custos into the current Git repository.

- Verify the current directory is inside a Git repo.
- Ensure `.git/hooks` exists.
- Write or update `.git/hooks/pre-push` to call `custos scan --pre-push`.
- Preserve existing hook content when possible.
- Make the hook executable.
- Print what was installed and how to remove it.

Hook content:

```sh
#!/bin/sh
custos scan --pre-push
```

During development, point to the local binary via `npm link` or `pnpm link`. Before demo, confirm the `custos` command resolves correctly.

### `custos scan`

Orchestrates the full core loop.

- `custos scan` — manual scan, always interactive.
- `custos scan --pre-push` — hook mode; exits 0 to allow or 1 to block.
- `custos scan --json` — machine-readable output for tests or MCP.

Exit codes:
- `0`: No blocking findings, patch applied, or override approved.
- `1`: Push blocked.

### `custos doctor`

Validates environment before a demo.

- Confirm Node version.
- Confirm Git availability.
- Check `BACKBOARD_API_KEY`, `BACKBOARD_BASE_URL`.
- Check `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`.
- Check `MONGODB_URI`, test MongoDB connection.
- Print a pass/fail summary per check.

### `custos audit`

Shows recent audit events from MongoDB.

- Connect to MongoDB.
- Fetch recent events sorted by `createdAt` descending.
- Render a concise terminal list with eventType, finding title, user, and timestamp.

## Scanner Architecture

### Layer 1: Local Deterministic Rules (human-owned)

Rules live in `src/scanner/rules.ts`. Each rule is a function:

```ts
type Rule = (hunk: DiffHunk) => Finding | null;
```

`scanDiff.ts` runs every rule against every hunk and collects results. Agents scaffold this runner and provide stub rules. The human fills in real detection logic.

Initial rule categories to stub:

- Hardcoded API keys (OpenAI, AWS, generic bearer tokens)
- Hardcoded passwords or secrets
- Private keys in source
- `.env` file content accidentally committed
- SQL query string concatenation with user input
- `eval` usage
- Dangerous `child_process.exec` with user-controlled input
- Wildcard CORS with credentials
- Prompt injection sink patterns in AI apps

Each stub should return `null` and include a comment describing what the rule should detect.

### Layer 2: AI Enrichment via Backboard

AI enrichment runs after local rules fire. It is never invoked before a `Finding` exists. It never replaces a finding — it only adds `explanation`, `recommendation`, and `patch` to an existing one.

If Backboard is unavailable or returns invalid JSON, the original finding is used as-is. The hook must not block or crash due to AI failure.

## Backboard Integration

### API

- Endpoint: `POST https://app.backboard.io/api/threads/messages`
- Auth: `X-API-Key` header
- Each call is stateless — no thread reuse between scans

### Two-call pattern

**Call 1 — Explain** (fast, cheap model):

```ts
{
  content: "<structured prompt with finding + code snippet>",
  llm_provider: "<fast provider>",      // human sets in prompts.ts
  model_name: "<fast model>",           // human sets in prompts.ts
  system_prompt: "<explain prompt>",    // human sets in prompts.ts
  json_output: true
}
```

Expected response shape (validated with zod):

```ts
{
  risk: Severity;
  is_exploitable: boolean;
  summary: string;
  recommendation: string;
}
```

**Call 2 — Patch** (stronger model, only invoked when user selects "Apply patch"):

```ts
{
  content: "<structured prompt requesting minimal safe patch>",
  llm_provider: "<strong provider>",    // human sets in prompts.ts
  model_name: "<strong model>",         // human sets in prompts.ts
  system_prompt: "<patch prompt>",      // human sets in prompts.ts
  json_output: true
}
```

Expected response shape:

```ts
{
  patch: string;      // the fixed code block
  explanation: string;
}
```

### Snippet policy

Send only:

- File path and language
- The matched diff hunk (added lines only)
- Up to 5 lines of surrounding context
- The rule name that triggered

Never send entire files or repositories.

### Validation

All Backboard responses are parsed with zod. If parsing fails:

- Fall back to the deterministic finding's `explanation` and `recommendation`.
- Log a warning to stderr.
- Do not crash.

## Auth0 Integration

Auth0 is used for authenticated, cryptographically accountable overrides. The approach goes beyond basic device auth — Auth0 becomes a **cryptographic witness** to the override decision, not just an identity gatekeeper.

### Flow

1. User selects "Force override with Auth0" in the action menu.
2. Custos prompts the user for an override reason (plain text, required).
3. Custos initiates Auth0 Device Authorization Flow.
4. Auth0 returns `device_code`, `user_code`, `verification_uri`.
5. Custos displays the verification URL and code, and optionally opens the browser.
6. Custos polls Auth0 until the user completes authentication.
7. Auth0 runs a post-login Action that reads finding context from the request and embeds it as custom claims in the issued JWT.
8. Custos receives the access token, decodes the custom claims, and verifies finding context is present.
9. Custos writes an `AuditEvent` to MongoDB that includes the decoded JWT claims.
10. Custos exits 0 to allow the push.

### JWT custom claims

The Auth0 post-login Action embeds finding context so the token itself is the signed record of the specific security decision:

```json
{
  "https://custos/finding_id": "...",
  "https://custos/severity": "critical",
  "https://custos/rule": "hardcoded-api-key",
  "https://custos/file": "src/server.ts",
  "https://custos/line": 12,
  "https://custos/commit_sha": "a3f9c1",
  "https://custos/override_reason": "deadline blocker"
}
```

The finding context is passed into the auth request via the `state` parameter or login hint, and read by the Action via `event.request.query` or `event.transaction`.

### Demo message to user

```text
Critical issue detected. To force this push, verify your identity.

Visit: https://auth0.com/activate
Code:  ABCD-EFGH

Waiting for verification...
```

### Polling behavior

- Respect Auth0's `interval` field.
- Handle `authorization_pending` — keep polling.
- Handle `slow_down` — increase interval.
- Handle `expired_token` — abort with clear message.
- Time out after 5 minutes.

### Environment variables

```env
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_AUDIENCE=
```

### What to tell judges

> "When a developer overrides a critical finding, Auth0 doesn't just verify their identity — it issues a JWT that names the exact vulnerability, file, commit, and override reason. The token is the audit record. Nobody can dispute what was approved because Auth0 signed it."

## MongoDB Audit Ledger

```ts
type AuditEvent = {
  eventType: string;
  repoName: string;
  repoPathHash: string;      // SHA256 of the local path for privacy
  branch?: string;
  commitSha?: string;
  userId?: string;
  userEmail?: string;
  finding?: Finding;
  overrideReason?: string;
  jwtClaims?: Record<string, unknown>;
  action: "allowed" | "blocked" | "patched" | "overridden";
  createdAt: Date;
};
```

Behavior:

- In normal scan mode, if MongoDB is unavailable: warn and continue.
- In override mode, prefer requiring a successful audit write before allowing the push. The point of override is accountability.

```env
MONGODB_URI=
MONGODB_DB=custos
```

## Severity Policy

- `critical`: Always block. Requires patch or Auth0 override.
- `high`: Block by default.
- `medium`: Warn, allow push.
- `low`: Informational only.

Blocking threshold is controlled by `CUSTOS_BLOCK_ON` (default: `critical,high`).

Example severities:

- Hardcoded production API key: `critical`
- Private key in source: `critical`
- SQL injection with user input: `critical`
- Dangerous exec with user input: `high`
- Wildcard CORS: `medium`
- Suspicious package name: `medium`

## Git Hook and Diff Strategy

Hook content written by `custos init`:

```sh
#!/bin/sh
custos scan --pre-push
```

Diff strategy (in order of preference):

1. Parse stdin refs passed by Git to determine pushed range: `<local-ref> <local-sha> <remote-ref> <remote-sha>`
2. Fall back to `git diff origin/main...HEAD`
3. Fall back to `git diff HEAD~1..HEAD`
4. Fall back to `git diff HEAD`

The hook must not perform any destructive Git operations. It must not auto-commit changes. If a patch is applied, it exits 1 and tells the user to review, stage, commit, and push again.

## Patch Application Policy

1. Generate or retrieve patch from Backboard.
2. Show the patch diff in the terminal.
3. Ask the user to confirm.
4. Apply only if the patch can be cleanly applied.
5. Exit 1.
6. Tell the user to review, stage, commit, and push again.

If patching fails:
- Show the manual fix recommendation.
- Block the push.
- Log the event to MongoDB if configured.

## Terminal UX Guidelines

Good output:

```text
Custos blocked this push.

CRITICAL  Hardcoded API key detected
File: src/server.ts:12

Why this matters:
This key could be exposed in the remote repository and used by anyone.

Suggested fix:
Move the secret to process.env.OPENAI_API_KEY.

? What do you want to do?
❯ Apply suggested patch
  View technical details
  Force override with Auth0
  Abort push
```

Guidelines:

- Show severity, file, line, explanation, and action.
- Keep colors meaningful — red for critical, yellow for high, blue for info.
- Make the safest option the default selection.
- Do not shame the developer.
- Do not emit raw JSON unless `--json` is requested.

## Environment Configuration

`.env.example`:

```env
# Backboard
BACKBOARD_API_KEY=
BACKBOARD_BASE_URL=https://app.backboard.io/api

# Auth0
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_AUDIENCE=

# MongoDB Atlas
MONGODB_URI=
MONGODB_DB=custos

# Custos behavior
CUSTOS_BLOCK_ON=critical,high
CUSTOS_ALLOW_OVERRIDE=true
CUSTOS_AI_PATCHES=true
CUSTOS_AUDIT_ENABLED=true
```

## Recommended Tech Stack

Node.js with TypeScript.

Core dependencies:

- `typescript`, `tsx` — compiler and dev runner
- `commander` — CLI command parsing
- `@clack/prompts` — interactive terminal prompts
- `chalk` — terminal colors
- `execa` — safe child process execution
- `zod` — runtime validation for AI responses and config
- `dotenv` — environment loading
- `mongoose` — MongoDB Atlas integration
- `simple-git` — Git metadata helper

Optional polish:

- `ora` — spinners
- `boxen` — highlighted terminal boxes
- `open` — opening URLs for Auth0 verification

## Development Priorities

Build in this order. Do not start a later phase before the earlier one is working:

1. TypeScript CLI scaffold — entry point, commander setup, command stubs, tsconfig, package.json
2. `custos scan` with diff extraction, diff parsing, and rule runner (stub rules only)
3. `custos init` and the pre-push hook
4. Terminal UI — finding renderer, action menu
5. MongoDB audit logging
6. Auth0 Device Flow and JWT claims
7. Backboard AI enrichment (explain + patch)
8. `custos doctor`
9. Demo fixture repository with vulnerable code
10. Optional: package typo guard (`custos guard`)
11. Optional: MCP server (`custos mcp`)
12. Polish: README, Devpost writeup, demo script

## Testing Strategy

High-value areas for unit tests:

- Scanner rule runner: given a DiffHunk, correct Finding is produced
- Severity mapping: rule match → correct severity
- Diff parsing: raw git diff string → correct DiffHunk[]
- Zod schema validation: AI responses parsed and rejected correctly
- AuditEvent shaping: correct fields populated

Manual test the full Git hook flow before demo:

1. Create a test repo.
2. Run `custos init`.
3. Add vulnerable code, commit it.
4. Run `git push` or simulate: `custos scan --pre-push`.
5. Confirm Custos blocks.
6. Apply patch. Confirm file changes.
7. Recommit. Confirm scan passes.
8. Test override path. Confirm MongoDB event exists with JWT claims.
9. Run `custos doctor`. Confirm all checks pass.

## Demo Script

1. "Most security tools catch issues after code reaches GitHub. Custos catches them before push."

2. Show install:
   ```bash
   custos init
   ```

3. Show vulnerable code:
   ```ts
   const OPENAI_API_KEY = "sk-demo-leaked-key";
   ```

4. Commit and push:
   ```bash
   git add . && git commit -m "add payment workflow" && git push
   ```

5. Custos blocks push. Show finding with explanation.

6. Apply patch. Show file change.

7. Recommit and push — scan passes.

8. Introduce second finding, choose "Force override with Auth0":
   - Show device verification URL and code.
   - Complete auth in browser.
   - Show MongoDB audit event with decoded JWT claims naming the exact finding.

9. Close: "Custos does not remove developer judgment. It makes risky judgment visible, authenticated, and auditable — and Auth0 signs every decision."

## Demo Vulnerabilities

### Primary (used in main demo flow)

```ts
// Hardcoded secret — triggers critical finding
const OPENAI_API_KEY = "sk-demo-leaked-key";
```

Fix:
```ts
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
```

### Secondary (used in override demo)

```ts
// SQL injection — triggers critical finding
const user = await db.query("SELECT * FROM users WHERE id = " + req.query.id);
```

Fix:
```ts
const user = await db.query("SELECT * FROM users WHERE id = ?", [req.query.id]);
```

## Non-Goals for the Hackathon MVP

Do not build these unless the core loop is complete and demo-ready:

- Enterprise admin dashboard
- Organization/team policy management
- Browser extension
- Full shell replacement
- Complete static analysis engine
- Secret revocation with cloud providers
- Multi-repository SaaS portal
- Production-grade patch application across every language

These can be mentioned as future roadmap items.

## Implementation Quality Bar

Prefer:

- Small, single-purpose functions
- Structured data over string-typed state
- `zod` validation at all external boundaries (AI, env config)
- Clear exit codes
- Minimal global state
- Safe defaults
- Helpful failure messages

Avoid:

- Silent network failures
- Crashing inside Git hooks
- Sending large code blobs to AI
- Overpromising security guarantees
- Building optional features before the core loop works

## Agent Collaboration Notes

- Read this file before making any architectural change.
- Maintain `MEMORY.md` at the repository root as the running implementation memory. Before creating a commit, pushing changes, or handing off work that is ready to commit, add a dated entry describing the change set: summary, affected files, functionality changed, notable imports/dependencies, test/build commands run, and follow-up context. Keep entries factual and specific enough that a future agent can reconstruct what changed without rereading the whole diff.
- **Before every push to this repository**, verify the change end-to-end against the dedicated sandbox repo at [`arunsabaratnam/custos-testing`](https://github.com/arunsabaratnam/custos-testing) (cloned locally as a sibling of this project). At minimum: run `npm run build` here so the linked/global `custos` binary reflects the latest `src/` changes, then in `custos-testing` run `custos init` (if not already installed), make a small commit, and run a real `git push` there to confirm the pre-push hook fires, the scan completes, and the hook does not crash or hang. Only push to this repo's own remote after that verification passes. Do not skip this because rules/prompts are still stubs — the goal is confirming the orchestration and hook plumbing work, not that findings are detected.
- Preserve the core demo loop unless the user explicitly changes direction.
- Never implement `src/scanner/rules.ts` logic or `src/ai/prompts.ts` content speculatively — scaffold interfaces and stubs only.
- Keep implementation pragmatic for hackathon constraints.
- Update this file when major product or architecture decisions change.
- Treat Auth0 and MongoDB integrations as sponsor-critical.
- Treat terminal UX as part of product quality, not decoration.
- AI enrichment must never be a hard dependency — the hook must work without Backboard configured.

## Current State

As of July 17, 2026, the repository contains only `README.md`, `LICENSE`, and `AGENTS.MD`. No application scaffold exists.

Architecture and integration design is complete. The next step is to scaffold the TypeScript CLI and implement Layer 1: the core scan and init flow.
