import type { DiffHunk, Finding } from "../scanner/types.js";
import type { ExplainResponse, PatchResponse } from "./schemas.js";

/**
 * Backboard HTTP client.
 *
 * Not implemented yet — later phase wires this to POST
 * https://app.backboard.io/api/threads/messages with the X-API-Key header,
 * using the model selection and prompts from src/ai/prompts.ts (human-owned).
 * Responses must be validated with the zod schemas in src/ai/schemas.ts.
 * If Backboard is unavailable or returns invalid JSON, callers must fall
 * back to the original Finding — this client must never throw in a way
 * that blocks the hook.
 */
export async function explainFinding(
  _finding: Finding,
  _hunk: DiffHunk,
): Promise<ExplainResponse> {
  throw new Error("explainFinding: not implemented");
}

export async function generatePatch(
  _finding: Finding,
  _hunk: DiffHunk,
): Promise<PatchResponse> {
  throw new Error("generatePatch: not implemented");
}
