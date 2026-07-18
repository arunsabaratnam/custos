import { openSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import tty from "node:tty";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { execa } from "execa";
import { getDiff } from "../git/getDiff.js";
import { parseDiff } from "../git/parseDiff.js";
import { scanDiff } from "../scanner/scanDiff.js";
import type { DiffHunk, Finding, Severity } from "../scanner/types.js";
import { renderFinding } from "../ui/renderFinding.js";
import { promptConfirm, promptFindingAction, promptOverrideReason } from "../ui/prompts.js";
import { renderBanner } from "../ui/banner.js";
import { withSpinner, startElapsedSpinner } from "../ui/spinner.js";
import {
  defaultRepoConfig,
  readRepoConfig,
  resolveRepoState,
  type PatchFormat,
} from "./repoState.js";

export type ScanOptions = {
  prePush?: boolean;
  json?: boolean;
};

type EffectiveConfig = {
  blockOn: Severity[];
  aiEnabled: boolean;
  auditEnabled: boolean;
  patchFormat: PatchFormat;
  repoRoot: string | null;
};

const DEFAULT_BLOCK_ON: Severity[] = ["critical", "high"];

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Returns the higher of two severities (AI enrichment can never downgrade). */
function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

/**
 * `custos scan` — orchestrates the full core loop (AGENTS.md "custos scan"):
 * extract diff → parse into DiffHunk[] → run scanner rules → render
 * findings → action menu → exit 0 (allow) or 1 (block).
 *
 * The hook must never crash with an unhandled exception — every branch
 * below is wrapped so failures fail closed (exit 1) instead of throwing.
 */
export async function runScan(options: ScanOptions): Promise<void> {
  const { prePush = false, json = false } = options;

  try {
    const config = await resolveEffectiveConfig();

    // Git pipes ref-pair lines on stdin in pre-push mode. Drain it fully
    // before doing anything else — this is the only chance to read it.
    let stdin: string | undefined;
    if (prePush && !process.stdin.isTTY) {
      stdin = await readAllStdin();
    }

    const rawDiff = await withSpinner("scan", "Reading outgoing diff...", () => getDiff(stdin));

    if (!rawDiff.trim()) {
      if (json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log(chalk.dim("No changes to scan."));
      }
      await tryWriteAudit(config.auditEnabled, {
        eventType: "scan_passed",
        action: "allowed",
        createdAt: new Date(),
      });
      process.exitCode = 0;
      return;
    }

    const hunks = parseDiff(rawDiff);
    let findings = scanDiff(hunks);

    if (findings.length === 0) {
      if (json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log(chalk.green("✓ No security issues detected."));
      }
      await tryWriteAudit(config.auditEnabled, {
        eventType: "scan_passed",
        action: "allowed",
        createdAt: new Date(),
      });
      process.exitCode = 0;
      return;
    }

    // AI enrichment — optional, skipped entirely if Backboard isn't
    // configured. Never allowed to change whether the push is blocked.
    if (config.aiEnabled && !json) {
      findings = await enrichFindings(findings, hunks);
    }

    if (json) {
      console.log(JSON.stringify(findings, null, 2));
      process.exitCode = findings.some((f) => config.blockOn.includes(f.severity)) ? 1 : 0;
      return;
    }

    renderBanner();

    for (const finding of findings) {
      renderFinding(finding);
      await tryWriteAudit(config.auditEnabled, {
        eventType: "finding_detected",
        finding,
        action: "blocked",
        createdAt: new Date(),
      });
    }

    const blocking = findings.filter((f) => config.blockOn.includes(f.severity));

    if (blocking.length === 0) {
      console.log(chalk.yellow("\n⚠ Warnings detected. Push allowed."));
      process.exitCode = 0;
      return;
    }

    console.log(
      chalk.red.bold(`\nCustos blocked this push. ${blocking.length} issue(s) require action.\n`),
    );

    const commitSha = await getCommitSha();
    const interactive = await ensureInteractiveInput(prePush);

    if (!interactive) {
      // No usable TTY (CI, GUI Git client, etc.) — never hang the hook
      // waiting for input that can't arrive. Block with guidance instead.
      for (const finding of blocking) {
        console.log(chalk.bold("\nManual fix required (no interactive terminal available):"));
        console.log(finding.recommendation);
        await tryWriteAudit(config.auditEnabled, {
          eventType: "finding_blocked",
          finding,
          action: "blocked",
          createdAt: new Date(),
        });
      }
      process.exitCode = 1;
      return;
    }

    await resolveBlockingFindings(blocking, hunks, config, commitSha);
  } catch (err) {
    // Hook must never crash unhandled — log and exit 1 to block push safely.
    console.error(chalk.red("\n[custos] Unexpected error:"), (err as Error).message);
    process.exitCode = 1;
  }
}

/**
 * Walks the interactive action menu for each blocking finding in turn.
 * Returns once a terminal decision (abort/view/patch/override) has set
 * `process.exitCode` for the run.
 */
async function resolveBlockingFindings(
  blocking: Finding[],
  hunks: DiffHunk[],
  config: EffectiveConfig,
  commitSha: string | undefined,
): Promise<void> {
  for (const finding of blocking) {
    const action = await promptFindingAction(Boolean(finding.patch));

    if (action === "abort") {
      await tryWriteAudit(config.auditEnabled, {
        eventType: "finding_blocked",
        finding,
        action: "blocked",
        createdAt: new Date(),
      });
      clack.outro(chalk.red("Push aborted."));
      process.exitCode = 1;
      return;
    }

    if (action === "view-details") {
      console.log(chalk.bold("\nEvidence:"));
      console.log(chalk.dim(finding.evidence));
      console.log("");
      await tryWriteAudit(config.auditEnabled, {
        eventType: "finding_blocked",
        finding,
        action: "blocked",
        createdAt: new Date(),
      });
      process.exitCode = 1;
      return;
    }

    if (action === "apply-patch") {
      await handleApplyPatch(finding, hunks, config);
      return;
    }

    if (action === "override") {
      await handleOverride(finding, config, commitSha);
      return;
    }
  }
}

async function handleApplyPatch(
  finding: Finding,
  hunks: DiffHunk[],
  config: EffectiveConfig,
): Promise<void> {
  const hunk = hunks.find((h) => h.file === finding.file);
  let patch = finding.patch;

  if (!patch && hunk) {
    try {
      patch = await withSpinner("think", "Generating patch with Backboard AI...", async () => {
        const generated = await tryGeneratePatch(finding, hunk);
        if (!generated) throw new Error("no patch generated");
        return generated;
      });
    } catch {
      patch = undefined;
    }
  }

  if (!patch) {
    console.log(chalk.yellow("\nNo patch available. Manual fix required:"));
    console.log(finding.recommendation);
    await tryWriteAudit(config.auditEnabled, {
      eventType: "finding_blocked",
      finding,
      action: "blocked",
      createdAt: new Date(),
    });
    process.exitCode = 1;
    return;
  }

  if (config.patchFormat === "diff") {
    console.error(
      chalk.dim(
        "[custos] Unified-diff patch format is not implemented yet — applying as a direct replacement instead.",
      ),
    );
  }

  console.log(chalk.bold("\nSuggested patch:"));
  console.log(chalk.green(patch));
  console.log("");

  const confirmed = await promptConfirm("Apply this patch to the file?", false);
  if (!confirmed) {
    await tryWriteAudit(config.auditEnabled, {
      eventType: "finding_blocked",
      finding,
      action: "blocked",
      createdAt: new Date(),
    });
    process.exitCode = 1;
    return;
  }

  try {
    await applyPatch(finding.file, finding.evidence, patch, config.repoRoot);
  } catch (err) {
    console.log(chalk.yellow(`\nCould not apply patch automatically: ${(err as Error).message}`));
    console.log(chalk.yellow("Manual fix required:"));
    console.log(finding.recommendation);
    await tryWriteAudit(config.auditEnabled, {
      eventType: "finding_blocked",
      finding,
      action: "blocked",
      createdAt: new Date(),
    });
    process.exitCode = 1;
    return;
  }

  await tryWriteAudit(config.auditEnabled, {
    eventType: "patch_applied",
    finding,
    action: "patched",
    createdAt: new Date(),
  });

  clack.outro(chalk.green("Patch applied. Review the change, stage it, commit, and push again."));
  // Custos never lets a patched file ride through on the same push.
  process.exitCode = 1;
}

async function handleOverride(
  finding: Finding,
  config: EffectiveConfig,
  commitSha: string | undefined,
): Promise<void> {
  const reason = await promptOverrideReason();
  if (!reason) {
    clack.outro(chalk.red("Override cancelled."));
    process.exitCode = 1;
    return;
  }

  const override = await tryOverride(finding, reason, commitSha);

  if (!override.success) {
    await tryWriteAudit(config.auditEnabled, {
      eventType: "override_denied",
      finding,
      overrideReason: reason,
      action: "blocked",
      createdAt: new Date(),
    });
    clack.outro(chalk.red("Authentication failed. Override cancelled."));
    process.exitCode = 1;
    return;
  }

  const audited = await tryWriteAudit(config.auditEnabled, {
    eventType: "override_approved",
    finding,
    overrideReason: reason,
    userEmail: override.userEmail,
    jwtClaims: override.claims,
    action: "overridden",
    createdAt: new Date(),
  });

  if (!audited) {
    const proceedUnlogged = await promptConfirm(
      "Audit write failed — this override will not be logged. Continue anyway?",
      false,
    );
    if (!proceedUnlogged) {
      clack.outro(chalk.red("Override cancelled — push blocked (audit log required)."));
      process.exitCode = 1;
      return;
    }
  }

  clack.outro(
    chalk.green(`Override approved. Authenticated as ${override.userEmail ?? "unknown"}. Push allowed.`),
  );
  process.exitCode = 0;
}

// ---------------------------------------------------------------------------
// Config resolution — `.custos/config.json` wins over env vars whenever it
// exists (AGENTS.md's env vars remain the fallback before `custos init`).
// ---------------------------------------------------------------------------

async function resolveEffectiveConfig(): Promise<EffectiveConfig> {
  let repoRoot: string | null = null;

  try {
    const state = await resolveRepoState();
    repoRoot = state.repoRoot;
    const fileConfig = await readRepoConfig(state.configPath);

    if (fileConfig) {
      return {
        blockOn: fileConfig.blockingThreshold as Severity[],
        aiEnabled: fileConfig.ai.enabled && Boolean(process.env.BACKBOARD_API_KEY),
        auditEnabled: fileConfig.audit.enabled,
        patchFormat: fileConfig.patchFormat,
        repoRoot,
      };
    }
  } catch {
    // Not a Git repo, or config unreadable — fall back to env vars/defaults.
  }

  return {
    blockOn: parseBlockOnEnv(),
    aiEnabled: process.env.CUSTOS_AI_PATCHES !== "false" && Boolean(process.env.BACKBOARD_API_KEY),
    auditEnabled: process.env.CUSTOS_AUDIT_ENABLED !== "false",
    patchFormat: defaultRepoConfig.patchFormat,
    repoRoot,
  };
}

function parseBlockOnEnv(): Severity[] {
  const raw = process.env.CUSTOS_BLOCK_ON;
  if (!raw) return DEFAULT_BLOCK_ON;

  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Severity => ["low", "medium", "high", "critical"].includes(s));

  return parsed.length > 0 ? parsed : DEFAULT_BLOCK_ON;
}

// ---------------------------------------------------------------------------
// Stdin / TTY handling
// ---------------------------------------------------------------------------

function readAllStdin(): Promise<string> {
  return new Promise<string>((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

/**
 * Returns whether interactive prompts can be used for the rest of this run.
 *
 * In manual mode, `process.stdin` is already a usable TTY (or the process
 * has no blocking findings to prompt about). In `--pre-push` mode, Git has
 * already consumed stdin for ref-pair lines by the time this is called, so
 * `@clack/prompts` (which always reads `process.stdin` internally) can no
 * longer read input from it. This attempts the same fix real Git-hook tools
 * use (e.g. husky's `exec < /dev/tty`): reopen `/dev/tty` directly and swap
 * it in as `process.stdin`. If that's not possible (Windows, CI, no
 * controlling terminal), interactive prompts are skipped entirely rather
 * than risking a hang.
 */
async function ensureInteractiveInput(prePush: boolean): Promise<boolean> {
  if (!prePush) {
    return process.stdin.isTTY === true;
  }

  if (process.stdin.isTTY) {
    return true;
  }

  if (process.platform === "win32") {
    return false;
  }

  try {
    const fd = openSync("/dev/tty", "r");
    const ttyStream = new tty.ReadStream(fd);

    Object.defineProperty(process, "stdin", {
      configurable: true,
      enumerable: true,
      get: () => ttyStream,
    });

    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Guarded integration call-sites — each is wrapped so a missing/throwing
// implementation degrades gracefully instead of crashing the hook.
// ---------------------------------------------------------------------------

async function tryWriteAudit(auditEnabled: boolean, event: Record<string, unknown>): Promise<boolean> {
  if (!auditEnabled) return false;

  try {
    const { writeAuditEvent } = await import("../audit/writeAudit.js");
    await writeAuditEvent(event as Parameters<typeof writeAuditEvent>[0]);
    return true;
  } catch (err) {
    console.error(chalk.dim(`[custos] Audit write skipped: ${(err as Error).message}`));
    return false;
  }
}

async function enrichFindings(findings: Finding[], hunks: DiffHunk[]): Promise<Finding[]> {
  return withSpinner("think", "Enriching findings with Backboard AI...", async () => {
    const enriched: Finding[] = [];

    for (const finding of findings) {
      const hunk = hunks.find((h) => h.file === finding.file);
      if (!hunk) {
        enriched.push(finding);
        continue;
      }

      try {
        const { explainFinding } = await import("../ai/backboardClient.js");
        const result = await explainFinding(finding, hunk);
        enriched.push({
          ...finding,
          // AI may raise severity but never lower it — a downgrade must not
          // be able to flip a rule's critical finding into an allowed push.
          severity: maxSeverity(finding.severity, result.risk),
          explanation: result.summary,
          recommendation: result.recommendation,
          source: "hybrid",
        });
      } catch {
        enriched.push(finding);
      }
    }

    return enriched;
  }).catch(() => findings);
}

async function tryGeneratePatch(finding: Finding, hunk: DiffHunk): Promise<string | null> {
  try {
    const { generatePatch } = await import("../ai/backboardClient.js");
    const result = await generatePatch(finding, hunk);
    return result.patch;
  } catch {
    return null;
  }
}

async function tryOverride(
  finding: Finding,
  reason: string,
  commitSha: string | undefined,
): Promise<{
  success: boolean;
  claims: Record<string, unknown>;
  userEmail?: string;
  context?: Record<string, unknown>;
}> {
  let findingContext: Record<string, unknown> | undefined;
  try {
    const { buildFindingContext } = await import("../auth/claimsBuilder.js");
    const { requestDeviceCode, pollForToken } = await import("../auth/deviceFlow.js");

    const context = buildFindingContext(finding, commitSha, reason);
    findingContext = context;
    const deviceCode = await requestDeviceCode(context);

    console.log("");
    console.log(chalk.bold("Verify your identity to override this finding."));
    console.log("");
    console.log(`  Visit:  ${chalk.cyan(deviceCode.verification_uri)}`);
    console.log(`  Code:   ${chalk.bold.yellow(deviceCode.user_code)}`);
    console.log("");

    try {
      const { default: open } = await import("open");
      await open(deviceCode.verification_uri_complete ?? deviceCode.verification_uri);
      console.log(chalk.dim("  (Browser opened automatically)"));
    } catch {
      // Opening a browser is best-effort only.
    }

    const waiter = startElapsedSpinner("auth", "Waiting for verification...");

    try {
      const result = await pollForToken(deviceCode.device_code, deviceCode.interval);
      waiter.stop("Verified.", true);
      const email = String(result.claims["email"] ?? result.claims["https://custos/email"] ?? "");
      return {
        success: true,
        // Merge the finding context under the token claims so the audit
        // record always names the exact finding, even if Auth0 strips the
        // custom params from the issued token.
        claims: { ...findingContext, ...result.claims },
        userEmail: email || undefined,
        context: findingContext,
      };
    } catch (err) {
      waiter.stop("Verification failed.", false);
      throw err;
    }
  } catch (err) {
    console.error(chalk.red(`[custos] Override failed: ${(err as Error).message}`));
    return { success: false, claims: {}, context: findingContext };
  }
}

async function getCommitSha(): Promise<string | undefined> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "HEAD"]);
    return stdout.trim().slice(0, 7);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

/**
 * Applies a "replace" patch: substitutes the exact matched `evidence`
 * snippet in `file` with `patch`. Only ever writes inside the repo root
 * (rejects absolute paths / `..` traversal), never touches a shell, and
 * refuses to guess when the evidence can't be located exactly once.
 */
async function applyPatch(
  file: string,
  evidence: string,
  patch: string,
  repoRoot: string | null,
): Promise<void> {
  const targetPath = resolveSafeFilePath(file, repoRoot);
  const content = await fs.readFile(targetPath, "utf8");
  const evidenceTrimmed = evidence.trim();

  const occurrences = content.split(evidenceTrimmed).length - 1;
  if (occurrences === 0) {
    throw new Error(`Could not locate the flagged code in ${file}. Manual patch required.`);
  }
  if (occurrences > 1) {
    throw new Error(`The flagged code appears more than once in ${file}. Manual patch required.`);
  }

  const updated = content.replace(evidenceTrimmed, patch.trim());
  await fs.writeFile(targetPath, updated, "utf8");
}

function resolveSafeFilePath(file: string, repoRoot: string | null): string {
  const base = repoRoot ?? process.cwd();
  const resolved = path.resolve(base, file);
  const normalizedBase = path.resolve(base) + path.sep;

  if (!resolved.startsWith(normalizedBase)) {
    throw new Error(`Refusing to write outside the repository: ${file}`);
  }

  return resolved;
}
