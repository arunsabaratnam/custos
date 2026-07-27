import { z } from "zod";
import type { DiffHunk, Finding } from "../scanner/types.js";
import { redactSecrets, type AiScanContext } from "../context/buildScanContext.js";
import {
  aiScanResponseSchema,
  explainResponseSchema,
  patchResponseSchema,
  type AiScanResponse,
  type ExplainResponse,
  type PatchResponse,
} from "./schemas.js";
import {
  buildExplainPrompt,
  buildPatchPrompt,
  buildSecurityScanPrompt,
  getExplainModel,
  getPatchModel,
  getSecurityScanModel,
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
  assistant_id?: string;
  memory?: "off";
  web_search?: "off";
  metadata?: Record<string, unknown>;
};

function ruleContext(finding: Finding, hunk: DiffHunk): BackboardPromptContext {
  return {
    finding: { ...finding, evidence: redactSecrets(finding.evidence) },
    hunk: {
      ...hunk,
      addedLines: hunk.addedLines.map((line) => ({ ...line, content: redactSecrets(line.content) })),
      context: redactSecrets(hunk.context),
    },
    ruleName: finding.id,
  };
}

async function callBackboard(body: BackboardCall, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) {
    throw new Error("BACKBOARD_API_KEY is not set");
  }

  const baseUrl = (process.env.BACKBOARD_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${baseUrl}/threads/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) {
        return await res.json();
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === 1) {
        throw new Error(`Backboard responded ${res.status} ${res.statusText}`);
      }

      await delay(retryDelayMs(res.headers.get("retry-after")));
    }
  } finally {
    clearTimeout(timeout);
  }

  throw new Error("Backboard request failed without a response");
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
      for (const candidate of parseJsonCandidates(trimmed)) candidates.push(candidate);
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

/** Handles strict JSON, fenced JSON, and a JSON object surrounded by prose. */
function parseJsonCandidates(value: string): unknown[] {
  const candidates: unknown[] = [];
  const sources = [
    value,
    ...[...value.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]!.trim()),
  ];

  for (const source of sources) {
    try {
      candidates.push(JSON.parse(source));
      continue;
    } catch {
      // Try extracting the outermost JSON object from surrounding prose.
    }

    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start === -1 || end <= start) continue;

    try {
      candidates.push(JSON.parse(source.slice(start, end + 1)));
    } catch {
      // The caller will produce the normal schema mismatch fallback.
    }
  }

  return candidates;
}

function parseWith<T>(schema: z.ZodTypeAny, raw: unknown): T {
  const issues: string[] = [];
  for (const candidate of extractPayload(raw) as unknown[]) {
    const result = schema.safeParse(candidate);
    if (result.success && result.data !== undefined) {
      return result.data as T;
    }
    const failure = result as { success: false; error: z.ZodError };
    issues.push(
      failure.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
        .join("; "),
    );
  }
  const detail = issues.find(Boolean);
  throw new Error(`Backboard response did not match the expected schema${detail ? ` (${detail})` : ""}`);
}

function retryDelayMs(retryAfter: string | null): number {
  const seconds = Number.parseFloat(retryAfter ?? "");
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds * 1_000), 5_000);
  }
  return 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    memory: "off",
    web_search: "off",
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
    memory: "off",
    web_search: "off",
  });
  return parseWith<PatchResponse>(patchResponseSchema, raw);
}

/** Runs one bounded, structured security review for the entire outgoing diff. */
export async function reviewSecurityContext(context: AiScanContext): Promise<AiScanResponse> {
  const model = getSecurityScanModel();
  // Keep structured scans separate from a general assistant. This avoids
  // attached RAG documents or tools influencing JSON-only security reviews.
  const scanAssistantId = process.env.BACKBOARD_SCAN_ASSISTANT_ID;
  const raw = await callBackboard(
    {
      content: "Review this bounded Git diff context for newly introduced security vulnerabilities.",
      system_prompt: buildSecurityScanPrompt(context),
      llm_provider: model.llm_provider,
      model_name: model.model_name,
      json_output: true,
      ...(scanAssistantId ? { assistant_id: scanAssistantId } : {}),
      memory: "off",
      web_search: "off",
      metadata: { source: "custos-security-scan", context_version: context.version },
    },
    context.limits.timeoutMs,
  );
  return parseWith<AiScanResponse>(aiScanResponseSchema, raw);
}
