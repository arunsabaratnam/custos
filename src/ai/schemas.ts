import { z } from "zod";

const normalizeEnum = (value: unknown): unknown =>
  typeof value === "string" ? value.trim().toLowerCase().replaceAll("_", "-") : value;

export const severitySchema = z.preprocess(normalizeEnum, z.enum(["low", "medium", "high", "critical"]));
export const findingCategorySchema = z.preprocess(
  (value) => {
    const normalized = normalizeEnum(value);
    if (normalized === "secrets" || normalized === "credential" || normalized === "credentials") return "secret";
    if (normalized === "authentication" || normalized === "authorization") return "auth";
    if (normalized === "prompt-injection" || normalized === "ai" || normalized === "ai-safety") return "ai-safety";
    return normalized;
  },
  z.enum(["secret", "injection", "auth", "dependency", "ai-safety"]),
);
export const exploitabilitySchema = z.enum(["low", "medium", "high", "unknown"]);

const normalizeConfidence = (value: unknown): unknown => {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) && numeric > 1 && numeric <= 100 ? numeric / 100 : value;
};

export const explainResponseSchema = z.object({
  risk: severitySchema,
  is_exploitable: z.boolean(),
  summary: z.string(),
  recommendation: z.string(),
});
export type ExplainResponse = z.infer<typeof explainResponseSchema>;

export const patchResponseSchema = z.object({
  patch: z.string(),
  explanation: z.string(),
});
export type PatchResponse = z.infer<typeof patchResponseSchema>;

/**
 * Independent Backboard review output. Patches are intentionally excluded
 * here: scanning should stay fast and every code change remains on-demand.
 */
export const aiScanFindingSchema = z.object({
  severity: severitySchema,
  category: findingCategorySchema,
  title: z.string().trim().min(3).max(160),
  file: z.string().trim().min(1).max(500),
  line: z.coerce.number().int().positive().optional(),
  evidence: z.string().trim().min(3).max(2_000),
  explanation: z.string().trim().min(3).max(2_000),
  recommendation: z.string().trim().min(3).max(2_000),
  confidence: z.preprocess(normalizeConfidence, z.coerce.number().min(0).max(1)).default(0.75),
  exploitability: z.preprocess(normalizeEnum, exploitabilitySchema).default("unknown"),
  trustBoundary: z.string().trim().min(3).max(500).optional(),
});
export type AiScanFinding = z.infer<typeof aiScanFindingSchema>;

export const aiScanResponseSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return { findings: value };
    if (!value || typeof value !== "object") return value;

    const response = value as Record<string, unknown>;
    const findings = response.findings ?? response.issues ?? response.security_findings;
    if (Array.isArray(findings)) return { ...response, findings };
    if (findings && typeof findings === "object") return { ...response, findings: [findings] };
    return value;
  },
  z.object({ findings: z.array(aiScanFindingSchema).max(20) }),
);
export type AiScanResponse = z.infer<typeof aiScanResponseSchema>;
