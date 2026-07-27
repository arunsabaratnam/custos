import { createHash } from "node:crypto";
import { redactSecrets, type AiScanContext } from "../context/buildScanContext.js";
import type { AiScanFinding } from "../ai/schemas.js";
import type { Finding, Severity } from "./types.js";

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function mergeFindings(
  ruleFindings: Finding[],
  aiFindings: AiScanFinding[],
  context: AiScanContext,
  minConfidence: number,
): Finding[] {
  const merged = [...ruleFindings];

  for (const candidate of aiFindings) {
    if (!isGrounded(candidate, context)) continue;

    const aiFinding = toFinding(candidate, minConfidence);
    const matchingIndex = merged.findIndex((existing) => isSameFinding(existing, aiFinding));

    if (matchingIndex === -1) {
      merged.push(aiFinding);
      continue;
    }

    const existing = merged[matchingIndex]!;
    merged[matchingIndex] = {
      ...existing,
      severity: higherSeverity(existing.severity, aiFinding.severity),
      explanation: aiFinding.explanation,
      recommendation: aiFinding.recommendation,
      source: "hybrid",
      confidence: aiFinding.confidence,
      exploitability: aiFinding.exploitability,
      trustBoundary: aiFinding.trustBoundary,
    };
  }

  return merged;
}

function toFinding(candidate: AiScanFinding, minConfidence: number): Finding {
  return {
    id: `ai-${stableId(candidate)}`,
    severity: candidate.confidence >= minConfidence ? candidate.severity : capAtMedium(candidate.severity),
    category: candidate.category,
    title: candidate.title,
    file: candidate.file,
    line: candidate.line,
    evidence: redactSecrets(candidate.evidence),
    explanation: candidate.explanation,
    recommendation: candidate.recommendation,
    source: "ai",
    confidence: candidate.confidence,
    exploitability: candidate.exploitability,
    trustBoundary: candidate.trustBoundary,
  };
}

function isGrounded(candidate: AiScanFinding, context: AiScanContext): boolean {
  const file = context.files.find((entry) => entry.path === candidate.file);
  if (!file) return false;
  if (candidate.line !== undefined && !file.addedLines.some((line) => line.line === candidate.line)) return false;

  const haystack = `${file.addedLines.map((line) => line.content).join("\n")}\n${file.nearbyContext}`.toLowerCase();
  const evidence = redactSecrets(candidate.evidence).trim().toLowerCase();
  return evidence.length >= 3 && (haystack.includes(evidence) || evidence.includes("[redacted"));
}

function isSameFinding(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) return false;
  if (a.line !== undefined && b.line !== undefined && Math.abs(a.line - b.line) > 3) return false;
  if (a.category === b.category) return true;
  return overlap(a.evidence, b.evidence) >= 0.5;
}

function overlap(a: string, b: string): number {
  const left = new Set(a.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  const right = new Set(b.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / Math.min(left.size, right.size);
}

function higherSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

function capAtMedium(severity: Severity): Severity {
  return SEVERITY_RANK[severity] > SEVERITY_RANK.medium ? "medium" : severity;
}

function stableId(candidate: AiScanFinding): string {
  return createHash("sha256")
    .update(`${candidate.file}:${candidate.line ?? 0}:${candidate.category}:${candidate.title}`)
    .digest("hex")
    .slice(0, 12);
}
