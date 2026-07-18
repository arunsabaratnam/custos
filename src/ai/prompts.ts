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
