import fs from "node:fs/promises";
import path from "node:path";
import type { DiffHunk, Finding, FindingCategory, Severity } from "../scanner/types.js";

export type AiScanLimits = {
  maxFiles: number;
  maxLinesPerFile: number;
  maxFindings: number;
  timeoutMs: number;
};

export type AiScanFile = {
  path: string;
  language: string;
  addedLines: Array<{ line: number; content: string }>;
  nearbyContext: string;
};

export type AiScanContext = {
  version: 1;
  files: AiScanFile[];
  knownFindings: AiKnownFinding[];
  dependencyManifest?: { path: string; excerpt: string };
  limits: Pick<AiScanLimits, "maxFindings" | "timeoutMs">;
  omittedFileCount: number;
};

/** Rule output supplied to Backboard for one-pass enrichment, never a patch. */
export type AiKnownFinding = {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  file: string;
  line?: number;
  evidence: string;
};

const DEFAULT_LIMITS: AiScanLimits = {
  maxFiles: 5,
  maxLinesPerFile: 120,
  maxFindings: 5,
  timeoutMs: 10_000,
};

const SENSITIVE_FILE = /(^|\/)\.env(?:\.|$)|(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$|\.(?:pem|key|p12|pfx)$/i;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g;
const TOKEN_VALUE = /\b(?:sk|rk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_\-]{8,}\b/g;
const ASSIGNED_SECRET = /((?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*["'`])(?:\\.|[^"'`]){4,}(["'`])/gi;

export function readAiScanLimits(env = process.env): AiScanLimits {
  return {
    maxFiles: positiveInt(env.CUSTOS_AI_MAX_FILES, DEFAULT_LIMITS.maxFiles, 1, 20),
    maxLinesPerFile: positiveInt(env.CUSTOS_AI_MAX_LINES_PER_FILE, DEFAULT_LIMITS.maxLinesPerFile, 1, 500),
    maxFindings: positiveInt(env.CUSTOS_AI_MAX_FINDINGS, DEFAULT_LIMITS.maxFindings, 1, 20),
    timeoutMs: positiveInt(env.CUSTOS_AI_TIMEOUT_MS, DEFAULT_LIMITS.timeoutMs, 1_000, 60_000),
  };
}

/** Builds a small, redacted payload; raw repository files never leave this boundary. */
export async function buildScanContext(
  hunks: DiffHunk[],
  repoRoot: string | null,
  limits = readAiScanLimits(),
  findings: Finding[] = [],
): Promise<AiScanContext> {
  const byFile = new Map<string, DiffHunk[]>();
  for (const hunk of hunks) {
    if (isSensitivePath(hunk.file)) continue;
    const current = byFile.get(hunk.file) ?? [];
    current.push(hunk);
    byFile.set(hunk.file, current);
  }

  const allFiles = [...byFile.entries()];
  const selected = allFiles.slice(0, limits.maxFiles);
  const files = selected.map(([file, fileHunks]) => toScanFile(file, fileHunks, limits.maxLinesPerFile));

  return {
    version: 1,
    files,
    knownFindings: findings.slice(0, limits.maxFindings).map(toKnownFinding),
    ...(await dependencyManifest(repoRoot)),
    limits: { maxFindings: limits.maxFindings, timeoutMs: limits.timeoutMs },
    omittedFileCount: Math.max(0, allFiles.length - selected.length),
  };
}

function toKnownFinding(finding: Finding): AiKnownFinding {
  return {
    id: finding.id,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    file: finding.file,
    line: finding.line,
    evidence: redactSecrets(finding.evidence),
  };
}

export function redactSecrets(value: string): string {
  return value
    .replace(PRIVATE_KEY, "[REDACTED PRIVATE KEY]")
    .replace(TOKEN_VALUE, "[REDACTED TOKEN]")
    .replace(ASSIGNED_SECRET, "$1[REDACTED]$2");
}

function toScanFile(file: string, hunks: DiffHunk[], maxLines: number): AiScanFile {
  const addedLines = hunks
    .flatMap((hunk) => hunk.addedLines)
    .slice(0, maxLines)
    .map((line) => ({ ...line, content: redactSecrets(line.content) }));

  return {
    path: file,
    language: hunks[0]?.language ?? "unknown",
    addedLines,
    nearbyContext: redactSecrets(hunks.flatMap((hunk) => hunk.context.split("\n")).filter(Boolean).slice(0, 12).join("\n")),
  };
}

async function dependencyManifest(repoRoot: string | null): Promise<Partial<AiScanContext>> {
  if (!repoRoot) return {};

  const manifestPath = path.join(repoRoot, "package.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const excerpt = JSON.stringify(
      {
        dependencies: parsed.dependencies ?? {},
        devDependencies: parsed.devDependencies ?? {},
      },
      null,
      2,
    );
    return { dependencyManifest: { path: "package.json", excerpt: redactSecrets(excerpt).slice(0, 8_000) } };
  } catch {
    return {};
  }
}

function isSensitivePath(file: string): boolean {
  return SENSITIVE_FILE.test(file.replaceAll("\\", "/"));
}

function positiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
