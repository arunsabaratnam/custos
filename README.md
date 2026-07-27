# Custos ₍⸍⸌̣ʷ̣̫⸍̣⸌₎ﾉ🔒

Custos is a terminal-native CLI tool that brings extreme shift-left security to solo developers and small teams.

In the age of agentic coding, risky changes can slip in fast. Custos runs in your command line, installs a local Git `pre-push` hook, scans outgoing diffs before code leaves your laptop, and turns security decisions into clear terminal actions: patch it, inspect it, override with accountability, or block the push.

<br />
<div align="center">

[![Devpost | custos](https://badges.devpost-shields.com/get-badge?name=custos&id=custos-9xl5k4&type=big-logo&style=for-the-badge)](https://devpost.com/software/custos-9xl5k4)

</div>

## What It Does

- Scans outgoing Git diffs locally before push.
- Detects security issues in changed lines with deterministic rules.
- Runs a bounded Backboard AI security review alongside deterministic rules, then merges grounded results.
- Explains why each finding matters and what to do next.
- Offers an interactive action flow for patching, details, overrides, and exit.
- Supports multi-issue navigation so the developer can choose which finding to analyze.
- Writes structured audit events to MongoDB Atlas.
- Gates enabled push overrides through Auth0 Device Authorization Flow and a verified ID token.

## Screenshots

### Welcome

The main `custos` screen shows project status, hook installation, and the core commands.

![Custos welcome screen](docs/screenshots/welcome.png)

### Scan Finding

`custos scan` renders findings directly in the terminal with severity, file location, explanation, and suggested fix.

![Custos scan finding](docs/screenshots/scan-finding.png)

### Audit Table

`custos audit --table` shows recent MongoDB audit events in a compact terminal table.

![Custos audit table](docs/screenshots/audit-table.png)

### Doctor Check

`custos doctor` verifies the local setup for Git, Auth0, MongoDB, and Backboard configuration.

![Custos doctor check](docs/screenshots/doctor.png)

## Core Flow

```text
git push
  -> pre-push hook
  -> custos scan --pre-push
  -> outgoing diff
  -> deterministic scanner rules + bounded AI review
  -> terminal finding UI
  -> patch, details, Auth0 override, or abort
  -> MongoDB audit log
```

If Custos applies a patch, it still exits with a blocking status. The developer reviews the change, stages it, commits it, and pushes again.

## Commands

```bash
custos              # welcome screen and project status
custos init         # install the local pre-push hook
custos scan         # manually scan outgoing changes
custos scan --json  # machine-readable scan output
custos audit        # read recent MongoDB audit events
custos audit --table
custos doctor       # check local integration setup
custos select       # interactive command launcher
```

## Installation

### Install From npm

Once the public package is published, install the `custos` command globally:

```bash
npm install --global custos
```

Then move into any Git repository you want to protect and initialize Custos:

```bash
cd /path/to/your-repository
custos init
```

This writes a `.custos/config.json` file and installs a `.git/hooks/pre-push` hook for that repository. Custos is installed globally, but protection is enabled separately per repository. The target repository needs Git and Node.js 18 or newer.

Place the integration credentials in the target repository's `.env` file or export them in the shell before scanning. Never commit `.env`.

### Local Development

To run the unreleased source build while developing Custos:

```bash
cd /path/to/custos
npm install
cp .env.example .env
npm run build
npm link
```

Then initialize a separate test repository:

```bash
cd /path/to/test-repository
custos init
```

`npm link` is convenient for active development because the global `custos` command points at the local package. `npm install --global .` is an alternative local installation that behaves more like a published package:

```bash
npm run build
npm install --global .
```

### Publishing Maintainers

The package is configured as a public, unscoped npm package. Publishing requires an npm account and should use 2FA:

```bash
npm login
npm version patch
npm pack --dry-run
npm publish
```

`prepublishOnly` builds `dist/` automatically before publishing. Review the `npm pack --dry-run` contents before release and confirm that no credentials, local configuration, tests, or development files are included.

## Configuration

Custos uses `.custos/config.json` for repo-level behavior and environment variables for secrets/integration credentials.

Important environment variables:

```env
MONGODB_URI=
MONGODB_DB=custos
CUSTOS_AUDIT_ENABLED=true

AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
CUSTOS_ALLOW_OVERRIDE=false

BACKBOARD_API_KEY=
BACKBOARD_BASE_URL=https://app.backboard.io/api
# Optional: a dedicated Backboard assistant with no attached documents or tools.
BACKBOARD_SCAN_ASSISTANT_ID=
```

Do not commit real `.env` files or secrets.

The AI scan sends only changed lines, limited nearby context, and a small dependency-manifest excerpt. Sensitive files such as `.env` and key files are excluded; recognizable secret values are redacted. AI-only findings must be grounded in supplied evidence, meet the configured confidence threshold, and default to blocking only at `critical` severity. Set `CUSTOS_AI_REQUIRED=true` when a failed AI review should block pre-push scans.

## Auth0 Overrides

Auth0 is optional. When enabled, it is only used during the pre-push flow, not plain `custos scan`.

If a developer selects `Force override with Auth0`, Custos:

1. Prompts for an override reason.
2. Starts Auth0 Device Authorization Flow.
3. Verifies the ID token signature, issuer, audience, expiration, and signing key against the Auth0 tenant JWKS.
4. Writes the finding, reason, verified identity claims, and decision into MongoDB Atlas.
5. Allows the push only after the override and audit write both succeed.

The CLI Device Authorization Flow uses `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID`. It does not use `AUTH0_CLIENT_SECRET`. Auth0's Device Authorization endpoint does not accept custom finding metadata, so the exact finding context is stored in the Custos audit record alongside the verified Auth0 identity rather than represented as a custom signed JWT claim.

## MongoDB Audit Log

When audit logging is enabled, Custos stores events such as:

- `scan_passed`
- `finding_detected`
- `finding_blocked`
- `patch_applied`
- `override_approved`
- `override_denied`

Audit records include repo metadata, branch, commit SHA, user identity when available, finding details, override reason, JWT claims, action, and timestamp.

## Development

```bash
npm run dev -- --help
npm run build
npm start
npm run lint
npm run typecheck
npm test
```

Run commands locally through TypeScript:

```bash
npm run dev
npm run dev -- init
npm run dev -- scan
npm run dev -- audit
npm run dev -- doctor
```

## Next Steps

- Add audit filters for repo, branch, user, severity, action, and time range.
- Add package typo-squatting detection and broader dependency analysis.
- Package Custos for installation without local linking.
- Add MCP support for terminal agents to inspect findings and audit history.

## Acknowledgements

<div align="center">

### This project was built for **Hack The 6ix 2026**

<img src="docs/screenshots/hackthe6ix_title.png" alt="Hack The 6ix" width="260" />

<br />
<br />

<img src="docs/screenshots/hackthe6ix.jpg" alt="Hack The 6ix event" width="320" />

**Hack The 6ix 2026**

---

### Sponsored Integrations

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/backboard.io.png" alt="Backboard.io" width="190" />
      <br />
      <strong>Backboard.io</strong>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/auth0.jpg" alt="Auth0" width="170" />
      <br />
      <strong>Auth0</strong>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/mongodb.png" alt="MongoDB" width="170" />
      <br />
      <strong>MongoDB Atlas</strong>
    </td>
  </tr>
</table>

</div>
