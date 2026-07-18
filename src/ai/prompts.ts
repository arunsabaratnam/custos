/**
 * HUMAN-OWNED FILE.
 *
 * Agents must not fill in real system prompts or model selection here.
 * The human developer decides the fast/cheap explain-call model and the
 * stronger patch-call model, and writes the prompts sent to Backboard,
 * per AGENTS.md's "Backboard Integration" section.
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

// Not implemented — human sets the fast/cheap model for finding explanation.
export function getExplainModel(): ModelSelection {
  throw new Error("getExplainModel: not implemented");
}

// Not implemented — human sets the stronger model for patch generation.
export function getPatchModel(): ModelSelection {
  throw new Error("getPatchModel: not implemented");
}

// Not implemented — human writes the explain-call system prompt.
export function buildExplainPrompt(_context: BackboardPromptContext): string {
  throw new Error("buildExplainPrompt: not implemented");
}

// Not implemented — human writes the patch-call system prompt.
export function buildPatchPrompt(_context: BackboardPromptContext): string {
  throw new Error("buildPatchPrompt: not implemented");
}
