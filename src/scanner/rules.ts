/**
 * HUMAN-OWNED FILE.
 *
 * This file contains the detection logic Custos runs against changed diff
 * lines. Agents must not implement regexes or heuristics here — every rule
 * below is a stub that returns null. The human developer fills in real
 * detection logic per AGENTS.md's "Scanner Architecture" section.
 */
import type { DiffHunk, Finding } from "./types.js";

export type Rule = (hunk: DiffHunk) => Finding | null;

// Detect hardcoded API keys (OpenAI, AWS, generic bearer tokens).
export const hardcodedApiKeyRule: Rule = (_hunk) => {
  return null;
};

// Detect hardcoded passwords or secrets.
export const hardcodedSecretRule: Rule = (_hunk) => {
  return null;
};

// Detect private keys committed in source (PEM/RSA/SSH key blocks).
export const privateKeyRule: Rule = (_hunk) => {
  return null;
};

// Detect .env file content accidentally committed.
export const dotEnvCommittedRule: Rule = (_hunk) => {
  return null;
};

// Detect SQL query string concatenation with user input.
export const sqlInjectionRule: Rule = (_hunk) => {
  return null;
};

// Detect eval() usage.
export const evalUsageRule: Rule = (_hunk) => {
  return null;
};

// Detect dangerous child_process.exec with user-controlled input.
export const dangerousExecRule: Rule = (_hunk) => {
  return null;
};

// Detect wildcard CORS configured alongside credentials.
export const wildcardCorsRule: Rule = (_hunk) => {
  return null;
};

// Detect prompt injection sink patterns in AI-app code.
export const promptInjectionSinkRule: Rule = (_hunk) => {
  return null;
};

export const rules: Rule[] = [
  hardcodedApiKeyRule,
  hardcodedSecretRule,
  privateKeyRule,
  dotEnvCommittedRule,
  sqlInjectionRule,
  evalUsageRule,
  dangerousExecRule,
  wildcardCorsRule,
  promptInjectionSinkRule,
];
