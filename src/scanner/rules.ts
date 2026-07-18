/**
 * Deterministic local detection rules.
 *
 * Each rule inspects only the *added* lines of a diff hunk and returns a
 * single `Finding` on the first match (or `null`). Rules are pure and
 * side-effect free so they stay trivially unit-testable. Where a safe,
 * mechanical fix exists, the rule attaches a `patch` string so the
 * apply-patch flow works with zero AI/Backboard dependency.
 *
 * False-positive tolerance is acceptable here — Custos always shows the
 * evidence and lets the developer decide. We still avoid obvious noise
 * (e.g. values already sourced from process.env).
 */
import type { DiffHunk, Finding, Severity } from "./types.js";

export type Rule = (hunk: DiffHunk) => Finding | null;

type AddedLine = { line: number; content: string };

/** Returns the first added line matching `test`, or null. */
function firstMatch(hunk: DiffHunk, test: (content: string) => boolean): AddedLine | null {
  for (const added of hunk.addedLines) {
    if (test(added.content)) return added;
  }
  return null;
}

function makeFinding(
  hunk: DiffHunk,
  matched: AddedLine,
  fields: {
    id: string;
    severity: Severity;
    category: Finding["category"];
    title: string;
    explanation: string;
    recommendation: string;
    patch?: string;
  },
): Finding {
  return {
    id: fields.id,
    severity: fields.severity,
    category: fields.category,
    title: fields.title,
    file: hunk.file,
    line: matched.line,
    evidence: matched.content.trim(),
    explanation: fields.explanation,
    recommendation: fields.recommendation,
    patch: fields.patch,
    source: "rule",
  };
}

/**
 * Derives an UPPER_SNAKE env-var name from an assignment's left-hand side,
 * e.g. `const openaiApiKey = "..."` → `OPENAI_API_KEY`. Falls back to a
 * generic name when the target can't be parsed.
 */
function envNameFromAssignment(line: string, fallback: string): string {
  const match = line.match(
    /(?:const|let|var|public|private|readonly)?\s*([A-Za-z_$][\w$]*)\s*[:=]/,
  );
  const identifier = match?.[1] ?? fallback;
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase()
    .replace(/^_+|_+$/g, "");
}

/** Builds a "replace the literal with process.env.X" patch for a single line. */
function envPatch(line: string, fallbackName: string): string | undefined {
  const envName = envNameFromAssignment(line, fallbackName);
  // Replace the first quoted string literal with the env reference.
  const patched = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/, `process.env.${envName}`);
  return patched === line ? undefined : patched.trim();
}

const USER_INPUT = /\b(req|request)\.(query|params|body|headers|cookies)|\bprocess\.argv|\buser_?input\b/i;

// --- Rules ------------------------------------------------------------------

// Hardcoded API keys: OpenAI (sk-...), AWS access key IDs (AKIA...),
// Google (AIza...), Slack (xox...), GitHub (ghp_/gho_...), or a generic
// long high-entropy token assigned to a *_key/token/secret variable.
export const hardcodedApiKeyRule: Rule = (hunk) => {
  const patterns: RegExp[] = [
    // OpenAI-style keys — tolerant of hyphen/underscore groups so demo
    // placeholders like "sk-demo-leaked-key" are caught alongside real keys.
    /\bsk-[A-Za-z0-9]{3,}(?:[-_][A-Za-z0-9]+)*\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z\-_]{20,}\b/,
    /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
    /\bgh[pousr]_[0-9A-Za-z]{20,}\b/,
  ];
  const matched = firstMatch(hunk, (c) => {
    if (/process\.env/.test(c)) return false;
    return patterns.some((p) => p.test(c));
  });
  if (!matched) return null;

  return makeFinding(hunk, matched, {
    id: "hardcoded-api-key",
    severity: "critical",
    category: "secret",
    title: "Hardcoded API key detected",
    explanation:
      "A live-looking API key is written directly in source. Once pushed, it is exposed in Git history to anyone with repo access and is effectively compromised.",
    recommendation:
      "Move the key to an environment variable (e.g. process.env) and rotate the exposed key immediately.",
    patch: envPatch(matched.content, "API_KEY"),
  });
};

// Hardcoded passwords / secrets / tokens assigned a string literal.
export const hardcodedSecretRule: Rule = (hunk) => {
  const assign =
    /\b(pass(word|wd)?|secret|token|api_?key|auth|credential|private_?key)\b\s*[:=]\s*(['"`])(?:\\.|(?!\3).){4,}\3/i;
  const matched = firstMatch(hunk, (c) => {
    if (/process\.env/.test(c)) return false;
    return assign.test(c);
  });
  if (!matched) return null;

  return makeFinding(hunk, matched, {
    id: "hardcoded-secret",
    severity: "high",
    category: "secret",
    title: "Hardcoded credential detected",
    explanation:
      "A password or secret is embedded as a string literal. Committing it leaks the credential into Git history where it cannot be truly deleted.",
    recommendation:
      "Load the value from an environment variable or a secrets manager, and rotate the leaked credential.",
    patch: envPatch(matched.content, "SECRET"),
  });
};

// Private key material committed in source.
export const privateKeyRule: Rule = (hunk) => {
  const matched = firstMatch(hunk, (c) =>
    /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/.test(c),
  );
  if (!matched) return null;

  return makeFinding(hunk, matched, {
    id: "private-key-in-source",
    severity: "critical",
    category: "secret",
    title: "Private key committed to source",
    explanation:
      "A private key block is being committed. Anyone with access to this repository (now or in the future) can impersonate this identity or decrypt its traffic.",
    recommendation:
      "Remove the key from source, store it in a secrets manager, and revoke/rotate the exposed key pair.",
  });
};

// .env-family file content being committed.
export const dotEnvCommittedRule: Rule = (hunk) => {
  const isDotEnv = hunk.language === "dotenv" || /(^|\/)\.env(\.|$)/.test(hunk.file);
  if (!isDotEnv) return null;

  // Only flag lines that actually assign a value (skip comments/blanks).
  const matched = firstMatch(hunk, (c) => /^\s*[A-Za-z_][\w]*\s*=\s*\S/.test(c));
  if (!matched) return null;

  return makeFinding(hunk, matched, {
    id: "dotenv-committed",
    severity: "high",
    category: "secret",
    title: ".env file with secrets is being committed",
    explanation:
      "Environment files typically hold secrets and are not meant to be tracked. Committing them exposes every value to anyone with repo access.",
    recommendation:
      "Add this file to .gitignore, remove it from the commit, and rotate any secrets it contained.",
  });
};

// SQL built by concatenating/interpolating user input into a query string.
export const sqlInjectionRule: Rule = (hunk) => {
  const sqlKeyword = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION)\b/i;
  const matched = firstMatch(hunk, (c) => {
    if (!sqlKeyword.test(c)) return false;
    const concatWithInput =
      (/["'`]\s*\+/.test(c) || /\$\{[^}]+\}/.test(c)) && USER_INPUT.test(c);
    return concatWithInput;
  });
  if (!matched) return null;

  return makeFinding(hunk, matched, {
    id: "sql-injection",
    severity: "critical",
    category: "injection",
    title: "SQL injection via string concatenation",
    explanation:
      "User-controlled input is concatenated directly into a SQL statement. An attacker can alter the query to read, modify, or destroy data.",
    recommendation:
      "Use parameterized queries / prepared statements and pass user input as bound parameters, never string concatenation.",
    patch: parameterizeSql(matched.content),
  });
};

/** Best-effort transform of `query("... " + expr)` → `query("... ?", [expr])`. */
function parameterizeSql(line: string): string | undefined {
  const patched = line.replace(
    /(\.query\s*\(\s*)(['"`])((?:\\.|(?!\2).)*)\2\s*\+\s*([^)]+?)(\s*\))/,
    (_all, open, quote, sql, expr, close) =>
      `${open}${quote}${String(sql).replace(/\s*$/, "")} ?${quote}, [${String(expr).trim()}]${close}`,
  );
  return patched === line ? undefined : patched.trim();
}

// eval() / new Function() — arbitrary code execution sinks.
export const evalUsageRule: Rule = (hunk) => {
  const matched = firstMatch(hunk, (c) => /\beval\s*\(/.test(c) || /\bnew\s+Function\s*\(/.test(c));
  if (!matched) return null;

  return makeFinding(hunk, matched, {
    id: "eval-usage",
    severity: "high",
    category: "injection",
    title: "Use of eval / new Function",
    explanation:
      "eval and new Function execute arbitrary strings as code. If any part of the input is attacker-influenced, this becomes remote code execution.",
    recommendation:
      "Remove eval/new Function. Parse data with JSON.parse or use an explicit, safe dispatch table instead.",
  });
};

// child_process exec/execSync with interpolated (user-controlled) input.
export const dangerousExecRule: Rule = (hunk) => {
  const matched = firstMatch(hunk, (c) => {
    if (!/\b(exec|execSync)\s*\(/.test(c)) return false;
    const dynamic = /\+/.test(c) || /\$\{[^}]+\}/.test(c) || /`[^`]*\$\{/.test(c);
    return dynamic;
  });
  if (!matched) return null;

  return makeFinding(hunk, matched, {
    id: "dangerous-exec",
    severity: "high",
    category: "injection",
    title: "Command injection via child_process.exec",
    explanation:
      "A shell command is built with dynamic input. If input is attacker-controlled, they can inject additional shell commands.",
    recommendation:
      "Use execFile/spawn with an argument array (no shell), and validate/allowlist any dynamic values.",
  });
};

// Wildcard CORS combined with credentials.
export const wildcardCorsRule: Rule = (hunk) => {
  const originStar = firstMatch(
    hunk,
    (c) =>
      /origin\s*[:=]\s*['"`]\*['"`]/i.test(c) ||
      /access-control-allow-origin['"`]?\s*[:,]\s*['"`]\*/i.test(c),
  );
  if (!originStar) return null;

  // Credentials may appear on the same line or elsewhere in the hunk.
  const credentials =
    /credentials\s*[:=]\s*true/i.test(originStar.content) ||
    hunk.addedLines.some((l) => /credentials\s*[:=]\s*true/i.test(l.content)) ||
    hunk.addedLines.some((l) =>
      /access-control-allow-credentials['"`]?\s*[:,]\s*['"`]?true/i.test(l.content),
    );
  if (!credentials) return null;

  return makeFinding(hunk, originStar, {
    id: "wildcard-cors-credentials",
    severity: "medium",
    category: "auth",
    title: "Wildcard CORS with credentials",
    explanation:
      "Allowing any origin (*) together with credentials lets any website make authenticated requests on behalf of your users.",
    recommendation:
      "Replace the wildcard with an explicit allowlist of trusted origins when credentials are enabled.",
  });
};

// User input concatenated directly into an LLM prompt / messages payload.
export const promptInjectionSinkRule: Rule = (hunk) => {
  const promptContext = /\b(prompt|system_?prompt|messages|content|completion|user_?message)\b/i;
  const matched = firstMatch(hunk, (c) => {
    if (!promptContext.test(c)) return false;
    const interpolated = (/\$\{[^}]+\}/.test(c) || /["'`]\s*\+/.test(c)) && USER_INPUT.test(c);
    return interpolated;
  });
  if (!matched) return null;

  return makeFinding(hunk, matched, {
    id: "prompt-injection-sink",
    severity: "medium",
    category: "ai-safety",
    title: "Prompt injection sink",
    explanation:
      "Untrusted user input is placed directly into an LLM prompt. An attacker can inject instructions that hijack the model's behavior.",
    recommendation:
      "Separate untrusted input from instructions, wrap/escape it clearly, and constrain the model with a fixed system prompt.",
  });
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
