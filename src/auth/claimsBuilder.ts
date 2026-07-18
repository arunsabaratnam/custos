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
 * Builds the finding context object passed into the Auth0 device flow
 * (via state/login_hint) and later read back from decoded JWT claims.
 *
 * Not implemented yet — later phase wires this per AGENTS.md's "Auth0
 * Integration" section.
 */
export function buildFindingContext(
  _finding: Finding,
  _commitSha: string | undefined,
  _overrideReason: string,
): FindingContext {
  throw new Error("buildFindingContext: not implemented");
}
