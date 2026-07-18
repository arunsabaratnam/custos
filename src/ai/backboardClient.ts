import type { DiffHunk, Finding } from "../scanner/types.js";
import {
  explainResponseSchema,
  patchResponseSchema,
  type ExplainResponse,
  type PatchResponse,
} from "./schemas.js";
import {
  buildExplainPrompt,
  buildPatchPrompt,
  getExplainModel,
  getPatchModel,
  type BackboardPromptContext,
} from "./prompts.js";

/**
 * Backboard HTTP client — the AI enrichment layer.
 *
 * Two stateless calls (no thread reuse): a cheap model explains a finding,
 * a stronger model generates a patch on demand. Every response is validated
 * with the zod schemas in ./schemas.js. This client is a *soft* dependency:
 * any failure (missing key, network error, bad JSON) throws, and callers in
 * scan.ts fall back to the deterministic finding — the hook never blocks or
 * crashes because of AI.
 */

const DEFAULT_BASE_URL = "https://app.backboard.io/api";
const REQUEST_TIMEOUT_MS = 20_000;

type BackboardCall = {
  content: string;
  system_prompt: string;
  llm_provider: string;
  model_name: string;
  json_output: true;
};

function ruleContext(finding: Finding, hunk: DiffHunk): BackboardPromptContext {
  return { finding, hunk, ruleName: finding.id };
}

async function callBackboard(body: BackboardCall): Promise<unknown> {
  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) {
    throw new Error("BACKBOARD_API_KEY is not set");
  }

  const baseUrl = (process.env.BACKBOARD_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/threads/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Backboard responded ${res.status} ${res.statusText}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Backboard wraps the model's JSON reply in an envelope whose exact shape
 * can vary. Locate the actual payload: use the top-level object if it
 * already carries the fields, otherwise dig through common content fields
 * (parsing JSON strings as needed).
 */
function extractPayload(raw: unknown): unknown {
  const candidates: unknown[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || value == null) return;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{")) {
        try {
          candidates.push(JSON.parse(trimmed));
        } catch {
          // not JSON — ignore
        }
      }
      return;
    }

    if (typeof value === "object") {
      candidates.push(value);
      const obj = value as Record<string, unknown>;
      for (const key of ["message", "content", "response", "data", "result", "output", "choices"]) {
        if (key in obj) visit(obj[key], depth + 1);
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
      }
    }
  };

  visit(raw, 0);
  return candidates;
}

function parseWith<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: unknown): T {
  for (const candidate of extractPayload(raw) as unknown[]) {
    const result = schema.safeParse(candidate);
    if (result.success && result.data !== undefined) {
      return result.data;
    }
  }
  throw new Error("Backboard response did not match the expected schema");
}

export async function explainFinding(finding: Finding, hunk: DiffHunk): Promise<ExplainResponse> {
  const model = getExplainModel();
  const context = ruleContext(finding, hunk);
  const raw = await callBackboard({
    content: `Explain and rate this security finding: ${finding.title}`,
    system_prompt: buildExplainPrompt(context),
    llm_provider: model.llm_provider,
    model_name: model.model_name,
    json_output: true,
  });
  return parseWith<ExplainResponse>(explainResponseSchema, raw);
}

export async function generatePatch(finding: Finding, hunk: DiffHunk): Promise<PatchResponse> {
  const model = getPatchModel();
  const context = ruleContext(finding, hunk);
  const raw = await callBackboard({
    content: `Produce a minimal safe patch for: ${finding.title}`,
    system_prompt: buildPatchPrompt(context),
    llm_provider: model.llm_provider,
    model_name: model.model_name,
    json_output: true,
  });
  return parseWith<PatchResponse>(patchResponseSchema, raw);
}
