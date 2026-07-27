import { openSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import tty from "node:tty";
import chalk from "chalk";
import { execa } from "execa";
import { getDiff } from "../git/getDiff.js";
import { parseDiff } from "../git/parseDiff.js";
import { buildScanContext, readAiScanLimits } from "../context/buildScanContext.js";
import { scanDiff } from "../scanner/scanDiff.js";
import { mergeFindings } from "../scanner/mergeFindings.js";
import type { DiffHunk, Finding, Severity } from "../scanner/types.js";
import { renderFinding } from "../ui/renderFinding.js";
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
  aiScanEnabled: boolean;
  aiRequired: boolean;
  aiBlockOn: Severity[];
  aiMinConfidence: number;
  aiPatchesEnabled: boolean;
  auditEnabled: boolean;
  authEnabled: boolean;
  allowOverride: boolean;
  patchFormat: PatchFormat;
  repoRoot: string | null;
};

const DEFAULT_BLOCK_ON: Severity[] = ["critical", "high"];
const DEFAULT_AI_BLOCK_ON: Severity[] = ["critical"];

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
    if (config.auditEnabled) {
      const { warmMongoConnection } = await import("../audit/mongo.js");
      warmMongoConnection();
    }

    // Git pipes ref-pair lines on stdin in pre-push mode. Newer Custos hooks
    // write those lines to CUSTOS_PRE_PUSH_STDIN_FILE and give this process
    // /dev/tty as stdin so interactive prompts can read arrow keys.
    let stdin: string | undefined;
    if (prePush) {
      stdin = await readPrePushStdin();
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
    const ruleFindings = scanDiff(hunks);
    let findings = ruleFindings;

    if (config.aiScanEnabled) {
      const aiLimits = readAiScanLimits();
      try {
        const runAiReview = async (): Promise<Finding[]> => {
          const context = await buildScanContext(hunks, config.repoRoot, aiLimits, ruleFindings);
          const { enrichSecurityFindings, reviewSecurityContext } = await import("../ai/backboardClient.js");
          const results = await Promise.allSettled([
            enrichSecurityFindings(context),
            reviewSecurityContext(context),
          ]);
          const [enrichmentResult, discoveryResult] = results;
          const completed = results
            .filter((result): result is PromiseFulfilledResult<{ findings: import("../ai/schemas.js").AiScanFinding[] }> => result.status === "fulfilled")
            .flatMap((result) => result.value.findings);

          if (completed.length === 0 && enrichmentResult?.status === "rejected" && discoveryResult?.status === "rejected") {
            throw enrichmentResult.reason;
          }

          return mergeFindings(
            ruleFindings,
            completed,
            context,
            config.aiMinConfidence,
          );
        };

        findings = json
          ? await runAiReview()
          : await withSpinner("think", "Reviewing changes with Backboard AI...", runAiReview);
      } catch (err) {
        const message = (err as Error).message;
        if (config.aiRequired && prePush) {
          if (!json) {
            console.error(chalk.red(`[custos] Required Backboard security scan failed: ${message}`));
          }
          await tryWriteAudit(config.auditEnabled, {
            eventType: "finding_blocked",
            action: "blocked",
            createdAt: new Date(),
          });
          process.exitCode = 1;
          return;
        }
        if (!json) {
          console.error(chalk.dim(`[custos] Backboard security scan skipped: ${message}`));
        }
      }
    } else if (config.aiRequired && prePush) {
      if (!json) {
        console.error(chalk.red("[custos] Required Backboard security scan is enabled but BACKBOARD_API_KEY is not configured."));
      }
      await tryWriteAudit(config.auditEnabled, {
        eventType: "finding_blocked",
        action: "blocked",
        createdAt: new Date(),
      });
      process.exitCode = 1;
      return;
    }

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

    if (json) {
      console.log(JSON.stringify(findings, null, 2));
      process.exitCode = findings.some((finding) => isBlockingFinding(finding, config)) ? 1 : 0;
      return;
    }

    await renderBanner();

    const findingAuditWrites: Array<Promise<boolean>> = [];
    for (const finding of findings) {
      renderFinding(finding);
      findingAuditWrites.push(tryWriteAudit(config.auditEnabled, {
        eventType: "finding_detected",
        finding,
        action: isBlockingFinding(finding, config) ? "blocked" : "allowed",
        createdAt: new Date(),
      }));
    }
    await Promise.all(findingAuditWrites);

    const blocking = findings.filter((finding) => isBlockingFinding(finding, config));

    if (blocking.length === 0) {
      console.log(chalk.yellow("\n⚠ Warnings detected. Push allowed."));
      process.exitCode = 0;
      return;
    }

    const blockedTarget = prePush ? "this push" : "this scan";
    console.log(chalk.red.bold(`\nCustos blocked ${blockedTarget}. ${blocking.length} issue(s) require action.\n`));

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

    await resolveBlockingFindings(blocking, hunks, config, commitSha, prePush);
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
  prePush: boolean,
): Promise<void> {
  const mode = prePush ? "pre-push" : "manual";

  if (blocking.length === 1) {
    await resolveFindingActions(blocking[0]!, blocking, hunks, config, commitSha, prePush, false);
    return;
  }

  for (;;) {
    const { promptIssueSelection } = await import("../ui/prompts.js");
    const selected = await promptIssueSelection(blocking, { mode });

    if (selected === "abort") {
      await auditBlockedFindings(config.auditEnabled, blocking);
      await promptOutro(chalk.red(prePush ? "Push aborted." : "Scan exited."));
      process.exitCode = 1;
      return;
    }

    const result = await resolveFindingActions(blocking[selected]!, blocking, hunks, config, commitSha, prePush, true);
    if (result === "terminal") {
      return;
    }
  }
}

async function resolveFindingActions(
  finding: Finding,
  allBlocking: Finding[],
  hunks: DiffHunk[],
  config: EffectiveConfig,
  commitSha: string | undefined,
  prePush: boolean,
  showBack: boolean,
): Promise<"terminal" | "back"> {
  for (;;) {
    const { promptFindingAction, promptReturnToActions } = await import("../ui/prompts.js");
    const action = await promptFindingAction({
      hasPatch: canApplyPatch(finding, hunks, config),
      mode: prePush ? "pre-push" : "manual",
      allowOverride: prePush && config.allowOverride,
      ...(showBack ? { showBack } : {}),
    });

    if (action === "back") {
      return "back";
    }

    if (action === "abort") {
      await auditBlockedFindings(config.auditEnabled, showBack ? allBlocking : [finding]);
      await promptOutro(chalk.red(prePush ? "Push aborted." : "Scan exited."));
      process.exitCode = 1;
      return "terminal";
    }

    if (action === "view-details") {
      renderTechnicalDetails(finding);
      await promptReturnToActions();
      continue;
    }

    if (action === "apply-patch") {
      const result = await handleApplyPatch(finding, hunks, config);
      if (result === "continue") {
        continue;
      }
      return "terminal";
    }

    if (action === "override") {
      await handleOverride(finding, config, commitSha);
      return "terminal";
    }
  }
}

function canApplyPatch(finding: Finding, hunks: DiffHunk[], config: EffectiveConfig): boolean {
  if (finding.patch) return true;

  return (
    config.aiPatchesEnabled &&
    isAiPatchEligible(finding) &&
    hunks.some((hunk) => hunk.file === finding.file)
  );
}

/** Findings involving tracked environment files require a Git action, not a source replacement. */
function isAiPatchEligible(finding: Finding): boolean {
  const fileName = finding.file.replace(/\\/g, "/").split("/").pop() ?? "";
  return fileName !== ".env";
}

function renderTechnicalDetails(finding: Finding): void {
  console.log("");
  console.log(chalk.bold("Technical details"));
  console.log(`${chalk.bold("Rule:")} ${finding.id}`);
  console.log(`${chalk.bold("Severity:")} ${finding.severity}`);
  console.log(`${chalk.bold("Category:")} ${finding.category}`);
  console.log(`${chalk.bold("Source:")} ${finding.source}`);
  console.log(`${chalk.bold("File:")} ${finding.file}${finding.line ? `:${finding.line}` : ""}`);
  if (finding.source !== "rule") {
    console.log(chalk.bold("\nBackboard analysis:"));
    if (finding.aiAnalysis) {
      console.log(`${chalk.bold("Assessed risk:")} ${finding.aiAnalysis.assessedRisk}`);
      console.log(`${chalk.bold("Exploitable:")} ${finding.aiAnalysis.isExploitable ? "yes" : "no"}`);
    }
    if (finding.confidence !== undefined) {
      console.log(`${chalk.bold("Confidence:")} ${Math.round(finding.confidence * 100)}%`);
    }
    if (finding.exploitability) {
      console.log(`${chalk.bold("Exploitability:")} ${finding.exploitability}`);
    }
    if (finding.trustBoundary) {
      console.log(`${chalk.bold("Trust boundary:")} ${finding.trustBoundary}`);
    }
  }
  console.log(chalk.bold("\nEvidence:"));
  console.log(chalk.dim(finding.evidence));
  console.log(chalk.bold("\nRecommendation:"));
  console.log(finding.recommendation);
  if (finding.patch) {
    console.log(chalk.bold("\nSuggested patch:"));
    console.log(chalk.green(finding.patch));
  }
  console.log("");
}

async function handleApplyPatch(
  finding: Finding,
  hunks: DiffHunk[],
  config: EffectiveConfig,
): Promise<"done" | "continue"> {
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
    return "done";
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

  const { promptConfirm } = await import("../ui/prompts.js");
  const confirmed = await promptConfirm("Apply this patch to the file?", false);
  if (!confirmed) {
    console.log(chalk.dim("Patch skipped."));
    return "continue";
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
    return "done";
  }

  await tryWriteAudit(config.auditEnabled, {
    eventType: "patch_applied",
    finding,
    action: "patched",
    createdAt: new Date(),
  });

  await promptOutro(chalk.green("Patch applied. Review the change, stage it, commit, and push again."));
  // Custos never lets a patched file ride through on the same push.
  process.exitCode = 1;
  return "done";
}

async function handleOverride(
  finding: Finding,
  config: EffectiveConfig,
  commitSha: string | undefined,
): Promise<void> {
  if (!config.allowOverride) {
    await promptOutro(chalk.red("Auth0 override is not enabled or configured. Push blocked."));
    process.exitCode = 1;
    return;
  }

  const { promptConfirm, promptOverrideReason } = await import("../ui/prompts.js");
  const reason = await promptOverrideReason();
  if (!reason) {
    await promptOutro(chalk.red("Override cancelled."));
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
    await promptOutro(chalk.red("Authentication failed. Override cancelled."));
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
      await promptOutro(chalk.red("Override cancelled — push blocked (audit log required)."));
      process.exitCode = 1;
      return;
    }
  }

  await promptOutro(
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
      const authEnabled = fileConfig.auth.enabled || parseBooleanEnv(process.env.CUSTOS_ALLOW_OVERRIDE, false);
      const aiRequested = fileConfig.ai.enabled && parseBooleanEnv(process.env.CUSTOS_AI_SCAN, true);
      const aiConfigured = Boolean(process.env.BACKBOARD_API_KEY);
      return {
        blockOn: fileConfig.blockingThreshold as Severity[],
        aiScanEnabled: aiRequested && aiConfigured,
        aiRequired: aiRequested && parseBooleanEnv(process.env.CUSTOS_AI_REQUIRED, false),
        aiBlockOn: parseSeverityEnv(process.env.CUSTOS_AI_BLOCK_ON, DEFAULT_AI_BLOCK_ON),
        aiMinConfidence: parseConfidenceEnv(process.env.CUSTOS_AI_MIN_CONFIDENCE),
        aiPatchesEnabled: fileConfig.ai.enabled && aiConfigured && parseBooleanEnv(process.env.CUSTOS_AI_PATCHES, true),
        auditEnabled: fileConfig.audit.enabled,
        authEnabled,
        allowOverride: authEnabled && hasAuth0Config(),
        patchFormat: fileConfig.patchFormat,
        repoRoot,
      };
    }
  } catch {
    // Not a Git repo, or config unreadable — fall back to env vars/defaults.
  }

  const aiRequested = parseBooleanEnv(process.env.CUSTOS_AI_SCAN, true);
  const aiConfigured = Boolean(process.env.BACKBOARD_API_KEY);
  return {
    blockOn: parseBlockOnEnv(),
    aiScanEnabled: aiRequested && aiConfigured,
    aiRequired: aiRequested && parseBooleanEnv(process.env.CUSTOS_AI_REQUIRED, false),
    aiBlockOn: parseSeverityEnv(process.env.CUSTOS_AI_BLOCK_ON, DEFAULT_AI_BLOCK_ON),
    aiMinConfidence: parseConfidenceEnv(process.env.CUSTOS_AI_MIN_CONFIDENCE),
    aiPatchesEnabled: aiConfigured && parseBooleanEnv(process.env.CUSTOS_AI_PATCHES, true),
    auditEnabled: process.env.CUSTOS_AUDIT_ENABLED !== "false",
    authEnabled: parseBooleanEnv(process.env.CUSTOS_ALLOW_OVERRIDE, false),
    allowOverride: parseBooleanEnv(process.env.CUSTOS_ALLOW_OVERRIDE, false) && hasAuth0Config(),
    patchFormat: defaultRepoConfig.patchFormat,
    repoRoot,
  };
}

function parseBlockOnEnv(): Severity[] {
  return parseSeverityEnv(process.env.CUSTOS_BLOCK_ON, DEFAULT_BLOCK_ON);
}

function parseSeverityEnv(raw: string | undefined, fallback: Severity[]): Severity[] {
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Severity => ["low", "medium", "high", "critical"].includes(s));

  return parsed.length > 0 ? parsed : fallback;
}

function parseConfidenceEnv(value: string | undefined): number {
  const confidence = Number.parseFloat(value ?? "");
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.85;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function hasAuth0Config(): boolean {
  return Boolean(process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID);
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

async function readPrePushStdin(): Promise<string | undefined> {
  const stdinFile = process.env.CUSTOS_PRE_PUSH_STDIN_FILE;
  if (stdinFile) {
    try {
      return await fs.readFile(stdinFile, "utf8");
    } catch (err) {
      console.error(chalk.dim(`[custos] Could not read Git pre-push refs: ${(err as Error).message}`));
      return undefined;
    }
  }

  if (!process.stdin.isTTY) {
    return readAllStdin();
  }

  return undefined;
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

async function promptOutro(message: string): Promise<void> {
  const clack = await import("@clack/prompts");
  clack.outro(message);
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

async function auditBlockedFindings(auditEnabled: boolean, findings: Finding[]): Promise<void> {
  await Promise.all(findings.map((finding) => tryWriteAudit(auditEnabled, {
      eventType: "finding_blocked",
      finding,
      action: "blocked",
      createdAt: new Date(),
    })));
}

async function tryGeneratePatch(finding: Finding, hunk: DiffHunk): Promise<string | null> {
  if (!isAiPatchEligible(finding)) return null;

  try {
    const { generatePatch } = await import("../ai/backboardClient.js");
    const result = await generatePatch(finding, hunk);
    const patch = result.patch.trim();
    return isSafeGeneratedPatch(finding, patch) ? patch : null;
  } catch {
    return null;
  }
}

/** Reject patches that cannot be a direct replacement for the matched evidence. */
function isSafeGeneratedPatch(finding: Finding, patch: string): boolean {
  if (!patch || patch.includes("```")) return false;
  if (patch.split("\n").length !== finding.evidence.split("\n").length) return false;

  const sourceKey = finding.evidence.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
  const patchKey = patch.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
  return !sourceKey || sourceKey === patchKey;
}

function isBlockingFinding(finding: Finding, config: EffectiveConfig): boolean {
  if (finding.source === "ai") {
    return (finding.confidence ?? 0) >= config.aiMinConfidence && config.aiBlockOn.includes(finding.severity);
  }
  return config.blockOn.includes(finding.severity);
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
      await waiter.stop("Verified.", true);
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
      await waiter.stop("Verification failed.", false);
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
