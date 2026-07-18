import { z } from "zod";

export const severitySchema = z.enum(["low", "medium", "high", "critical"]);

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
