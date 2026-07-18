import type { Finding } from "../scanner/types.js";

export type FindingContext = {
  "https://custos/finding_id": string;
  "https://custos/severity": string;
  "https://custos/rule": string;
  "https://custos/file": string;
  "https://custos/line"?: number;
  "https://custos/commit_sha"?: string;
  "https://custos/override_reason": string;
};

/**
 * Builds the namespaced finding context that is (a) passed into the Auth0
 * device-code request so a post-login Action can embed it as JWT claims,
 * and (b) written into the MongoDB audit record regardless of whether the
 * claims survive the round-trip — so the ledger always names the exact
 * finding that was overridden. Undefined optional fields are omitted so
 * they never serialize as `undefined`.
 */
export function buildFindingContext(
  finding: Finding,
  commitSha: string | undefined,
  overrideReason: string,
): FindingContext {
  const context: FindingContext = {
    "https://custos/finding_id": finding.id,
    "https://custos/severity": finding.severity,
    "https://custos/rule": finding.id,
    "https://custos/file": finding.file,
    "https://custos/override_reason": overrideReason,
  };

  if (finding.line !== undefined) {
    context["https://custos/line"] = finding.line;
  }
  if (commitSha) {
    context["https://custos/commit_sha"] = commitSha;
  }

  return context;
}
