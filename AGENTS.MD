# AGENTS.MD

This file is the operating guide for agents working on Custos. Treat it as the shared product, architecture, and implementation context for the project. If future decisions conflict with this file, prefer the smallest change that preserves the core demo loop and update this file with the new reasoning.

## Project Context

Custos is being built for Hack the 6ix 2026, a hackathon running July 17-19, 2026. A Devpost draft submission is required by 11:59pm on Saturday, July 18.

The hackathon judging criteria are:

- Technical difficulty: How hard was the project to build, and how much of the heavy lifting did the team implement?
- Uniqueness: Is the project meaningfully original, or just a common hackathon pattern with AI added?
- Design: Is the user experience intuitive, polished, and appropriate for the target user?
- Completeness: Does the project work end to end, with a clear demo and finished core flow?

Custos should be optimized for a strong live demo. The goal is not to build a production-grade security company in a weekend. The goal is to build a focused, credible, technically interesting developer-security workflow that judges can understand quickly.

## Product Summary

Custos is a terminal-native, local-first developer security sidekick.

It performs "extreme shift left" security by scanning code and risky commands before they leave the developer's machine. Instead of waiting for cloud CI scans, PR reviews, or asynchronous security dashboards, Custos intercepts dangerous code at the moment a developer tries to push it.

The central product claim:

> Security tools usually warn you after code reaches GitHub. Custos stops risky code at the terminal before it ever leaves the laptop.

Custos should feel like a natural part of a developer workflow:

```bash
git push
```

Then Custos wakes up, scans the outgoing diff, detects risky changes, explains the issue, offers an AI-assisted patch, and blocks the push unless the developer fixes the code or completes an accountable override.

## Core Demo Loop

The highest-priority feature is this loop:

1. The user runs `custos init`.
2. Custos installs a local Git `pre-push` hook.
3. The user commits vulnerable code.
4. The user runs `git push`.
5. The hook invokes Custos.
6. Custos extracts the outgoing Git diff.
7. Custos scans only the changed lines and nearby context.
8. Custos detects a security finding.
9. Custos shows a clear terminal explanation.
10. Custos offers actions:
    - Apply suggested patch
    - View details
    - Force override with Auth0
    - Abort push
11. If the user applies the patch, Custos edits the source file and exits with a blocking status so the user can review and recommit.
12. If the user overrides, Custos performs Auth0 Device Authorization Flow, logs the event to MongoDB Atlas, and allows the push.
13. If no high-risk findings exist, Custos allows the push.

This loop must be reliable before optional features are added.

## Target Sponsor Tracks

### Warp: Best Developer Tool

Custos is primarily a developer tool. The Warp story should focus on:

- Terminal-native workflow.
- Clean interactive CLI UX.
- Fast feedback before `git push` completes.
- Developer productivity and safety.
- Optional MCP integration so terminal agents can inspect Custos findings.

Do not make a generic web dashboard the center of the project. The terminal is the product surface.

### Backboard.io: Most Innovative Use

Backboard should be used as the AI routing layer, not just as a simple LLM API call.

The intended story:

- Cheap/fast models perform lightweight classification or explanation.
- Stronger models are used only when deeper reasoning or patch generation is needed.
- Custos sends minimal, relevant code snippets rather than entire repositories.
- AI is used where it adds value: exploitability reasoning, user-friendly explanation, and suggested patches.

Backboard should be framed as cost-aware and latency-aware model routing for security triage.

### Auth0: Best Use of Auth0

Auth0 should power accountable CLI overrides through Device Authorization Flow.

The intended story:

- A developer can override Custos, but cannot do so anonymously.
- The terminal displays a verification URL and code.
- The developer authenticates in a browser or mobile device.
- Custos polls until Auth0 approves the device flow.
- Custos logs the authenticated identity with the override event.

Be precise in wording. Custos does not directly implement Face ID or biometrics. Auth0 may use platform authenticators or passkeys depending on tenant setup. The accurate claim is "Auth0-backed device verification for terminal overrides."

### MongoDB Atlas: Best Use of MongoDB Atlas

MongoDB Atlas should store the audit ledger.

The intended story:

- Security findings and overrides are not ephemeral terminal messages.
- Custos stores structured, queryable audit events.
- Each record can include repo metadata, branch, commit, finding severity, user identity, override reason, timestamp, and action.
- Judges can see proof that risky decisions are tracked.

The minimal interface can be a CLI command such as `custos audit`. A web dashboard is optional and lower priority.

### General Hack the 6ix Placement

Custos can compete generally if the end-to-end demo is polished. The strongest framing is:

> Custos is a local-first security gate for developers that combines deterministic scanning, AI-assisted reasoning, authenticated human overrides, and persistent auditability.

## Non-Goals for the Hackathon MVP

Do not spend early time on these unless the core loop already works:

- Full enterprise admin dashboard.
- Real organization/team policy management.
- Browser extension.
- Full shell replacement.
- Full static analysis engine.
- Secret revocation with cloud providers.
- Multi-repository SaaS portal.
- Perfect package ecosystem intelligence.
- Production-grade patch application across every language.
- Extensive MCP integration before the CLI works.

These can be mentioned as future roadmap items.

## Recommended Tech Stack

Use Node.js with TypeScript.

Reasons:

- Fast to build during a hackathon.
- Excellent CLI ecosystem.
- Easy Git hook integration.
- Strong support for HTTP APIs.
- Good Auth0 and MongoDB support.
- Natural fit for MCP SDK work.
- Easy to package and run locally.

Recommended dependencies:

- `typescript`: TypeScript compiler.
- `tsx`: Run TypeScript files directly during development.
- `commander`: CLI command parsing.
- `@clack/prompts`: Interactive terminal prompts.
- `chalk`: Terminal colors.
- `execa`: Safe child process execution.
- `zod`: Runtime validation for config, findings, and AI JSON responses.
- `dotenv`: Local environment loading.
- `mongoose` or `mongodb`: MongoDB Atlas integration.
- `simple-git`: Git metadata helper, if useful.
- `diff`: Diff parsing or rendering support, if useful.
- `@modelcontextprotocol/sdk`: Optional MCP server integration.

Optional polish dependencies:

- `ora`: Spinners.
- `boxen`: Highlighted terminal boxes.
- `conf`: Local persisted CLI config.
- `open`: Opening URLs for Auth0 verification.

Avoid adding heavy frameworks unless they directly support the demo.

## Expected Repository Structure

A reasonable implementation structure:

```text
custos/
  package.json
  tsconfig.json
  README.md
  AGENTS.MD
  .env.example

  src/
    cli.ts

    commands/
      init.ts
      scan.ts
      doctor.ts
      audit.ts
      monitor.ts
      mcp.ts

    git/
      installHook.ts
      getDiff.ts
      parseDiff.ts
      repoInfo.ts

    scanner/
      scanDiff.ts
      rules.ts
      findings.ts
      severity.ts

    ai/
      backboardClient.ts
      prompts.ts
      patchGenerator.ts
      schemas.ts

    auth/
      auth0DeviceFlow.ts
      override.ts

    audit/
      mongo.ts
      auditModel.ts
      writeAudit.ts
      listAuditEvents.ts

    shell/
      packageGuard.ts
      typosquat.ts

    mcp/
      server.ts
      tools.ts

    ui/
      prompts.ts
      renderFinding.ts
      theme.ts

    config/
      loadConfig.ts
      schema.ts
```

This structure is a guide, not a strict requirement. If building quickly, keep files fewer and split later. Preserve the conceptual boundaries.

## CLI Commands

### `custos init`

Installs Custos into the current Git repository.

Responsibilities:

- Verify the current directory is inside a Git repo.
- Ensure `.git/hooks` exists.
- Write or update `.git/hooks/pre-push`.
- Preserve existing hook content when possible.
- Make the hook executable.
- Print what was installed and how to remove it.

The hook should invoke Custos in a way that works locally. During early development, this can point to the local project command. Before demo, make sure the command path is stable.

Expected outcome:

```bash
custos init
```

Outputs something like:

```text
Custos installed pre-push protection for this repository.
Future git push attempts will run custos scan --pre-push.
```

### `custos scan`

Scans the current Git diff.

Useful modes:

- `custos scan`: Manual scan for local development.
- `custos scan --pre-push`: Hook mode; exits with `0` to allow push and non-zero to block.
- `custos scan --json`: Machine-readable output for tests or MCP.

Responsibilities:

- Load config.
- Get Git diff.
- Parse changed files/hunks.
- Run local rules.
- Optionally run AI analysis.
- Render findings.
- Prompt user when in interactive mode.
- Return correct exit code.

Exit-code behavior:

- `0`: No blocking findings or override approved.
- `1`: Push should be blocked.

### `custos doctor`

Checks environment and setup.

Responsibilities:

- Confirm Node version.
- Confirm Git availability.
- Confirm repo status if relevant.
- Check required environment variables.
- Test MongoDB connection if configured.
- Validate Auth0 config if configured.
- Validate Backboard config if configured.

This command is valuable before a live demo.

### `custos audit`

Shows recent audit events from MongoDB Atlas.

Responsibilities:

- Connect to MongoDB.
- Fetch recent events.
- Render concise terminal table/list.
- Support optional filters later.

Example:

```bash
custos audit
```

Possible output:

```text
Recent Custos Events

[critical] Hardcoded API key blocked
Repo: hackthe6ix-demo
User: kyle@example.com
Action: override_approved
Time: 2026-07-18 20:43
```

### `custos monitor` or `custos guard`

Optional package typo protection demo.

Possible command:

```bash
custos guard npm install expresss
```

Responsibilities:

- Parse package installation command.
- Identify suspicious package names.
- Suggest likely intended package.
- Ask for confirmation before running.

This is secondary. Do not build it before the Git hook workflow works.

### `custos mcp`

Optional MCP server for Warp or compatible terminal agents.

Possible tools:

- `custos_scan_repo`
- `custos_explain_finding`
- `custos_recent_audits`
- `custos_generate_patch`

This is useful for the Warp story, but it is lower priority than a reliable CLI demo.

## Git Hook Design

Custos should use the Git `pre-push` hook.

Why `pre-push`:

- It runs before code reaches the remote.
- It supports the "before it leaves the laptop" story.
- It is easy to demonstrate live.
- It avoids requiring GitHub app installation.

Basic hook content:

```sh
#!/bin/sh
custos scan --pre-push
```

During local development, this may need to call a repo-local binary such as:

```sh
#!/bin/sh
npx tsx /absolute/path/to/src/cli.ts scan --pre-push
```

Before demo, prefer a stable command installed through `npm link`, `pnpm link`, or a package bin script.

Important:

- Hooks block pushes by exiting non-zero.
- Hooks allow pushes by exiting zero.
- Do not perform destructive Git operations inside the hook.
- Do not automatically commit changes from the hook.
- If a patch is applied, block the push and tell the user to review, stage, commit, and push again.

### Diff Strategy

Production-grade pre-push hooks receive local and remote refs on stdin. A robust implementation can parse those refs to determine exactly what is being pushed.

For the hackathon MVP, acceptable simplifications:

- Scan `git diff --cached` if changes are staged.
- Scan `git diff HEAD~1..HEAD` for the most recent commit.
- Scan `git diff origin/main...HEAD` if a remote tracking branch exists.
- Fall back to `git diff HEAD` during manual scans.

The most important thing is that the demo is reliable. If needed, design the demo repository to match the implemented diff strategy.

## Scanner Architecture

The scanner should have deterministic local rules first, then optional AI reasoning.

### Layer 1: Local Deterministic Rules

Local rules are fast, free, explainable, and reliable.

Initial rules should detect:

- Hardcoded API keys.
- Hardcoded secrets/passwords.
- Private keys.
- `.env` content or environment files accidentally committed.
- AWS-like access key IDs.
- OpenAI-like secret keys.
- Generic bearer tokens.
- SQL query string concatenation.
- `eval` usage.
- Dangerous `child_process.exec` patterns.
- Obvious auth bypasses.
- Dangerous CORS wildcard with credentials.
- Prompt injection sink patterns in AI apps.

Do not try to detect everything. Pick a few high-confidence findings that demo well.

### Layer 2: AI Analysis Through Backboard

AI should be invoked when:

- A local rule fires and needs explanation or patching.
- A pattern is ambiguous.
- A deeper exploitability assessment is useful.
- A patch needs to be generated.

Avoid sending entire files or repositories. Send only:

- File path.
- Language.
- Relevant diff hunk.
- Rule that triggered.
- Small amount of surrounding context, if available.

This supports a privacy-aware local-first story.

### Finding Data Model

All scanner outputs should normalize to a common structure:

```ts
type Finding = {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "secret" | "injection" | "auth" | "dependency" | "ai-safety";
  title: string;
  file: string;
  line?: number;
  evidence: string;
  explanation: string;
  recommendation: string;
  patch?: string;
  source: "rule" | "ai" | "hybrid";
};
```

The CLI, audit logger, AI layer, and MCP server should all use this shape or a close variant.

## Severity Policy

Suggested blocking policy:

- `critical`: Always block push unless patch applied or Auth0 override approved.
- `high`: Block by default, configurable later.
- `medium`: Warn by default.
- `low`: Informational.

Example severities:

- Hardcoded production API key: `critical`.
- Private key in source: `critical`.
- SQL injection with user input: `critical`.
- Dangerous command execution with user input: `high` or `critical`.
- Wildcard CORS without credentials: `medium`.
- Suspicious package typo: `medium` or `high`.

For the demo, use at least one `critical` example that blocks the push.

## AI Prompting Guidelines

Backboard responses should be requested as strict JSON and validated with `zod`.

The AI should be asked to:

- Determine exploitability.
- Explain the issue in plain developer language.
- Provide a minimal safe patch.
- Avoid inventing unavailable APIs.
- Avoid recommending broad rewrites.
- Return structured data only.

Example desired response:

```json
{
  "risk": "critical",
  "is_exploitable": true,
  "summary": "User-controlled input is concatenated into a SQL query.",
  "recommendation": "Use a parameterized query instead of string concatenation.",
  "patch": "..."
}
```

Always validate AI output. If validation fails:

- Fall back to deterministic finding details.
- Do not crash the hook.
- Do not allow a risky push solely because AI failed.

## Patch Application Policy

Auto-patching must be conservative.

Recommended flow:

1. Generate or retrieve patch.
2. Show the patch summary.
3. Ask the user to confirm.
4. Apply only if the patch can be applied cleanly.
5. Exit with blocking status.
6. Tell the user to review, stage, commit, and push again.

Do not silently patch and allow the same push. That is difficult to defend and can create unsafe behavior.

If patching fails:

- Show the suggested manual fix.
- Block the push.
- Log the failure if audit is enabled.

## Auth0 Device Authorization Flow

Auth0 should support the force-override flow.

Flow:

1. Custos requests a device code from Auth0.
2. Auth0 returns `device_code`, `user_code`, `verification_uri`, and optionally `verification_uri_complete`.
3. Custos shows the verification URL and user code.
4. Custos optionally opens the URL.
5. Custos polls Auth0 for completion.
6. User completes authentication.
7. Custos receives an access token or ID token.
8. Custos extracts user identity.
9. Custos asks for an override reason if not already provided.
10. Custos logs the override to MongoDB.
11. Custos exits `0` to allow the push.

Environment variables:

```env
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_AUDIENCE=
```

Implementation notes:

- Poll interval should respect Auth0's response.
- Handle `authorization_pending`.
- Handle `slow_down`.
- Handle expiry.
- Handle user cancellation.
- Time out gracefully.

The user-facing message should be clear:

```text
Critical issue detected. To force this push, verify your identity with Auth0.
Visit: https://...
Code: ABCD-EFGH
```

## MongoDB Audit Ledger

MongoDB Atlas stores structured events.

Suggested event model:

```ts
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
  action: "allowed" | "blocked" | "patched" | "overridden";
  createdAt: Date;
};
```

Hash local repo paths before storing them if possible. This supports privacy while still allowing stable grouping.

Environment variables:

```env
MONGODB_URI=
MONGODB_DB=custos
```

Audit logging should not make local development impossible. If MongoDB is unavailable:

- In normal scan mode, show a warning and continue.
- In override mode, prefer requiring a successful audit write before allowing the override, because the point of override is accountability.
- For demo, make sure MongoDB is configured and tested beforehand.

## Shell / Package Guard

This is optional but useful for demonstrating "continuous terminal defense."

The idea:

```bash
custos guard npm install react-domm
```

Custos should detect that `react-domm` is suspiciously close to `react-dom`.

Possible approach:

- Maintain a small local list of popular packages.
- Use edit distance or simple similarity checks.
- Flag one-character or two-character variants.
- Ask the user whether to continue.

Do not require live npm API calls for the demo. Network calls add fragility.

## MCP Integration

MCP is optional and should be built after the core CLI works.

Possible MCP tools:

- `custos_scan_repo`: Run a scan and return structured findings.
- `custos_explain_finding`: Explain a specific finding.
- `custos_recent_audits`: Return recent audit events.
- `custos_generate_patch`: Generate a patch for a finding.

The MCP story for Warp:

> Custos exposes its local security engine through MCP so terminal agents can inspect, explain, and act on security findings without leaving the developer workflow.

Keep MCP read-heavy at first. Avoid letting MCP tools modify files until the base patching flow is stable.

## Environment Configuration

Provide `.env.example` with:

```env
# Backboard
BACKBOARD_API_KEY=
BACKBOARD_BASE_URL=

# Auth0
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_AUDIENCE=

# MongoDB Atlas
MONGODB_URI=
MONGODB_DB=custos

# Custos
CUSTOS_BLOCK_ON=critical,high
CUSTOS_ALLOW_OVERRIDE=true
CUSTOS_AI_PATCHES=true
CUSTOS_AUDIT_ENABLED=true
```

Eventually support `.custosrc.json`:

```json
{
  "blockOn": ["critical", "high"],
  "allowOverride": true,
  "aiPatches": true,
  "audit": true
}
```

For the hackathon, `.env` is enough.

## Terminal UX Guidelines

Custos should be calm, clear, and developer-focused.

Good output:

```text
Custos blocked this push.

CRITICAL: Hardcoded API key detected
File: src/server.ts:12

Why this matters:
This key could be leaked to the remote repository.

Suggested fix:
Move the secret to process.env.OPENAI_API_KEY.
```

Bad output:

```text
SECURITY ALERT!!!!!!!!!!!!!
You are hacked!!!
```

Guidelines:

- Use concise headings.
- Show severity, file, line, explanation, and action.
- Do not overwhelm with raw JSON unless `--json` is requested.
- Keep colors meaningful.
- Keep prompts short.
- Make the safest option obvious.
- Do not shame the developer.

Suggested actions:

```text
? What do you want to do?
  Apply suggested patch
  View technical details
  Force override with Auth0
  Abort push
```

## Security and Privacy Principles

Custos should be described as local-first, not cloud-only.

Important principles:

- Scan locally before code leaves the machine.
- Prefer deterministic local rules when possible.
- Minimize snippets sent to AI.
- Redact obvious secrets before sending snippets to AI when possible.
- Do not send entire repositories to AI.
- Require authenticated accountability for critical overrides.
- Store structured audit records.
- Avoid pretending AI is perfect.

Important limitations to acknowledge:

- AI can be wrong.
- Static analysis can have false positives and false negatives.
- Regex-based secret detection is incomplete.
- Some vulnerabilities require runtime context.
- The hackathon MVP is not a replacement for CI, SAST, dependency scanning, or human review.

This honesty helps with judges. It makes the project sound credible.

## Development Priorities

Build in this order:

1. Scaffold TypeScript CLI.
2. Implement `custos scan` with deterministic local rules.
3. Implement Git diff extraction.
4. Implement `custos init` and the `pre-push` hook.
5. Add interactive terminal prompts.
6. Add MongoDB audit logging.
7. Add Auth0 Device Authorization Flow override.
8. Add Backboard AI explanation and patch generation.
9. Add a demo repository or demo fixture with vulnerable code.
10. Add `custos doctor`.
11. Add optional package typo guard.
12. Add optional MCP server.
13. Polish README, Devpost writeup, and demo script.

The top priority is a complete, reliable, impressive demo.

## Testing Strategy

Use focused tests where they reduce demo risk.

High-value test areas:

- Secret detection rules.
- SQL injection rule examples.
- Finding severity mapping.
- Diff parsing.
- Config loading.
- AI response schema validation.
- Audit event shaping.

Manual test the full Git hook flow:

1. Create a test repo.
2. Run `custos init`.
3. Add vulnerable code.
4. Commit it.
5. Run `git push` or simulate hook execution.
6. Confirm Custos blocks.
7. Apply patch.
8. Confirm patch changes file.
9. Recommit.
10. Confirm scan passes.
11. Test override path.
12. Confirm MongoDB event exists.

Before demo, run `custos doctor`.

## Demo Vulnerabilities

Use intentionally simple vulnerabilities that judges understand quickly.

Good examples:

### Hardcoded Secret

```ts
const OPENAI_API_KEY = "sk-demo-leaked-key";
```

Expected fix:

```ts
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
```

### SQL Injection

```ts
const user = await db.query("SELECT * FROM users WHERE id = " + req.query.id);
```

Expected fix:

```ts
const user = await db.query("SELECT * FROM users WHERE id = ?", [req.query.id]);
```

### Dangerous Command Execution

```ts
exec("convert " + req.body.filename);
```

Expected fix:

```ts
execFile("convert", [req.body.filename]);
```

Pick one primary vulnerability for the main demo and one secondary vulnerability for override demonstration.

## Suggested Devpost Framing

Short description:

> Custos is a local-first DevSec CLI sidekick that intercepts risky code at `git push`, uses AI-assisted reasoning to explain and patch vulnerabilities, and requires authenticated accountability for security overrides.

Problem:

> Security feedback often arrives too late: after code reaches GitHub, CI, or a PR. Developers need fast, local, actionable security feedback at the exact moment risky code is about to leave their machine.

Solution:

> Custos installs a pre-push hook that scans outgoing diffs, detects secrets and vulnerability patterns, routes suspicious snippets through AI for deeper analysis, generates suggested patches, and logs authenticated overrides to an audit ledger.

Technical highlights:

- Local Git `pre-push` interception.
- Deterministic rule scanner.
- Backboard-powered AI routing.
- Auth0 Device Authorization Flow for CLI overrides.
- MongoDB Atlas audit ledger.
- Optional MCP integration for terminal agents.

## Suggested Live Demo Script

1. Introduce the problem:

   "Most security tools catch issues after code reaches GitHub. Custos catches them before push."

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
   git add .
   git commit -m "add payment workflow"
   git push
   ```

5. Custos blocks push.

6. Show explanation and suggested fix.

7. Apply patch.

8. Show patched file.

9. Commit fix and push again.

10. Show override path:

    - Introduce second finding.
    - Choose "Force override with Auth0."
    - Complete device verification.
    - Show MongoDB audit event.

11. Close with:

    "Custos does not remove developer judgment. It makes risky judgment visible, authenticated, and auditable."

## Implementation Quality Bar

Prefer:

- Small, testable functions.
- Structured data over stringly typed state.
- `zod` validation at boundaries.
- Clear exit codes.
- Minimal global state.
- Safe defaults.
- Helpful failure messages.

Avoid:

- Silent network failures.
- Crashing inside Git hooks.
- Overly broad file rewrites.
- Sending large code blobs to AI.
- Overpromising security guarantees.
- Building unrelated UI before the CLI works.

## Agent Collaboration Notes

Future agents should:

- Read this file before making architectural changes.
- Preserve the core demo loop unless the user explicitly changes direction.
- Keep implementation choices pragmatic for hackathon constraints.
- Update this file when major product or architecture decisions change.
- Prioritize working software over speculative architecture.
- Use deterministic scanners before AI calls.
- Treat Auth0 and MongoDB integrations as sponsor-critical.
- Treat terminal UX as part of product quality, not decoration.

## Current State

At the time this guide was first created, the repository only contained:

- `README.md`
- `LICENSE`
- `AGENTS.MD`

No application scaffold existed yet. The next major step is to scaffold the TypeScript CLI and implement the core `custos scan` and `custos init` flow.
