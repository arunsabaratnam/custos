/**
 * Backboard model selection and system prompts.
 *
 * Two-call, cost-aware routing (the Backboard sponsor story):
 *   - explain call → a fast/cheap model to triage and describe a finding
 *   - patch call   → a stronger model, only when the user asks for a fix
 *
 * Model choices are overridable via environment variables so providers can
 * be swapped without code changes:
 *   CUSTOS_EXPLAIN_PROVIDER / CUSTOS_EXPLAIN_MODEL
 *   CUSTOS_PATCH_PROVIDER   / CUSTOS_PATCH_MODEL
 */
import type { AiScanContext } from "../context/buildScanContext.js";
import type { DiffHunk, Finding } from "../scanner/types.js";

export type ModelSelection = {
  llm_provider: string;
  model_name: string;
};

export type BackboardPromptContext = {
  finding: Finding;
  hunk: DiffHunk;
  ruleName: string;
};

// Fast/cheap model for triage + explanation.
export function getExplainModel(): ModelSelection {
  return {
    llm_provider: process.env.CUSTOS_EXPLAIN_PROVIDER ?? "openai",
    model_name: process.env.CUSTOS_EXPLAIN_MODEL ?? "gpt-4o-mini",
  };
}

// Stronger model for generating a minimal, correct patch.
export function getPatchModel(): ModelSelection {
  return {
    llm_provider: process.env.CUSTOS_PATCH_PROVIDER ?? "anthropic",
    model_name: process.env.CUSTOS_PATCH_MODEL ?? "claude-sonnet-4-6",
  };
}

/** Fast, structured independent scan. The exact model remains configurable. */
export function getSecurityScanModel(): ModelSelection {
  return {
    llm_provider: process.env.CUSTOS_AI_SCAN_PROVIDER ?? "openai",
    model_name: process.env.CUSTOS_AI_SCAN_MODEL ?? "gpt-4o-mini",
  };
}

/**
 * Trims the code context sent to the model to the minimum needed
 * (AGENTS.md snippet policy): only the added lines plus a few context
 * lines. Never sends whole files or repositories.
 */
function snippet(ctx: BackboardPromptContext): string {
  const added = ctx.hunk.addedLines.map((l) => `${l.line}: ${l.content}`).join("\n");
  const context = ctx.hunk.context
    ? ctx.hunk.context.split("\n").slice(0, 5).join("\n")
    : "(none)";

  return [
    `File: ${ctx.finding.file}${ctx.finding.line ? `:${ctx.finding.line}` : ""}`,
    `Language: ${ctx.hunk.language}`,
    `Rule: ${ctx.ruleName}`,
    `Flagged line: ${ctx.finding.evidence}`,
    "Added lines:",
    added,
    "Surrounding context:",
    context,
  ].join("\n");
}

export function buildExplainPrompt(context: BackboardPromptContext): string {
  const instructions = [
    "You are a senior application security engineer reviewing a single code change before it is pushed.",
    "Assess the flagged issue and respond with STRICT JSON only — no prose, no markdown fences.",
    "",
    "Respond with exactly this shape:",
    "{",
    '  "risk": "low" | "medium" | "high" | "critical",',
    '  "is_exploitable": boolean,',
    '  "summary": string,        // one or two plain-language sentences a developer will understand',
    '  "recommendation": string  // the concrete fix, imperative and specific',
    "}",
    "",
    "Rules:",
    "- Judge only the code shown; do not invent context.",
    "- Prefer the higher severity when genuinely uncertain — this gates a push.",
    "- Keep summary and recommendation concise and non-condescending.",
    "",
    "Code under review:",
    snippet(context),
  ];
  return instructions.join("\n");
}

export function buildPatchPrompt(context: BackboardPromptContext): string {
  const instructions = [
    "You are a senior engineer producing the smallest safe patch that fixes a specific security finding.",
    "Respond with STRICT JSON only — no prose, no markdown fences.",
    "",
    "Respond with exactly this shape:",
    "{",
    '  "patch": string,       // the corrected replacement for the flagged line(s) only',
    '  "explanation": string  // one sentence on what changed and why it is safe',
    "}",
    "",
    "Rules:",
    "- Change as little as possible; preserve surrounding style, indentation, and formatting.",
    "- Return only the exact replacement text for finding.evidence. Do not return file headers, comments, surrounding configuration, or a whole file.",
    "- If a safe one-to-one replacement is not possible, return an empty patch and explain the manual remediation.",
    "- The patch must be drop-in valid code for the given language.",
    "- Do not introduce new dependencies or placeholders like TODO.",
    "- For secrets, read from environment/config instead of literals.",
    "- For injection, use parameterized/escaped APIs instead of string building.",
    "",
    `Finding: ${context.finding.title} (${context.finding.severity})`,
    `Recommendation to satisfy: ${context.finding.recommendation}`,
    "",
    "Code to fix:",
    snippet(context),
  ];
  return instructions.join("\n");
}

/**
 * The context is constructed locally and already redacted. Do not add broad
 * repository-reading or network/tool instructions here; this call must stay
 * bounded, deterministic in shape, and suitable for a pre-push hook.
 */
export function buildSecurityScanPrompt(context: AiScanContext): string {
  return [
    "You are a senior application-security engineer and senior software engineer reviewing a Git diff before push.",
    "Identify exploitable security risks introduced by these changes. Consider trust boundaries, authentication, authorization, secrets, injection, unsafe deserialization, command execution, CORS, dependencies, and AI prompt injection.",
    "The context includes known deterministic findings. Assess every one: unless it is clearly a false positive, you MUST return one matching entry with the exact same file, line, and evidence so Custos can enrich it. You may also report additional grounded findings.",
    "Return only grounded findings. Do not invent files, lines, libraries, or runtime behavior. Prefer fewer high-signal findings over speculative warnings.",
    "Do not include chain-of-thought, markdown, or text outside the JSON object.",
    "",
    "Return exactly this JSON shape:",
    "{",
    '  "findings": [',
    "    {",
    '      "severity": "low" | "medium" | "high" | "critical",',
    '      "category": "secret" | "injection" | "auth" | "dependency" | "ai-safety",',
    '      "title": string,',
    '      "file": string,',
    '      "line": number,',
    '      "evidence": string,',
    '      "explanation": string,',
    '      "recommendation": string,',
    '      "confidence": number,',
    '      "exploitability": "low" | "medium" | "high" | "unknown",',
    '      "trustBoundary": string',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Each file and line must be present in the supplied context. Prefer changed lines for evidence.",
    "- Do not reconstruct, reveal, or request secret values; redacted values are intentionally unavailable.",
    "- Only report a finding when evidence supports a realistic exploit path.",
    "- Keep explanations and recommendations concise, concrete, and compatible with the existing code style.",
    `- Return at most ${context.limits.maxFindings} findings. Return an empty array when no grounded issue exists.`,
    "",
    "Bounded scan context:",
    JSON.stringify(context),
  ].join("\n");
}

/**
 * A compact companion request for findings the deterministic scanner already
 * confirmed. It is intentionally separate from discovery because a model may
 * reasonably return no new risks when every code value has been redacted.
 */
export function buildSecurityEnrichmentPrompt(context: AiScanContext): string {
  return [
    "You are a senior application-security engineer enriching confirmed deterministic security findings before a Git push.",
    "Every item in knownFindings is a confirmed policy violation. Return exactly one enrichment entry for every item; do not omit a finding because its sensitive value is redacted.",
    "Reuse each finding's exact file, line, and evidence. Do not discover additional findings in this request.",
    "Return only JSON, with no markdown or prose.",
    "",
    "Return exactly this JSON shape:",
    "{",
    '  "findings": [{',
    '    "severity": "low" | "medium" | "high" | "critical",',
    '    "category": "secret" | "injection" | "auth" | "dependency" | "ai-safety",',
    '    "title": string, "file": string, "line": number, "evidence": string,',
    '    "explanation": string, "recommendation": string, "confidence": number,',
    '    "exploitability": "low" | "medium" | "high" | "unknown", "trustBoundary": string',
    "  }]",
    "}",
    "",
    "Confirmed findings:",
    JSON.stringify({ knownFindings: context.knownFindings }),
  ].join("\n");
}
