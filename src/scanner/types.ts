export type Severity = "low" | "medium" | "high" | "critical";

export type FindingCategory = "secret" | "injection" | "auth" | "dependency" | "ai-safety";
export type FindingSource = "rule" | "ai" | "hybrid";
export type Exploitability = "low" | "medium" | "high" | "unknown";

export type AiAnalysis = {
  assessedRisk: Severity;
  isExploitable: boolean;
};

export type Finding = {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  file: string;
  line?: number;
  evidence: string;
  explanation: string;
  recommendation: string;
  patch?: string;
  source: FindingSource;
  /** Present for Backboard-originated analysis; deterministic rules are authoritative without it. */
  confidence?: number;
  exploitability?: Exploitability;
  trustBoundary?: string;
  /** Assessment from Backboard when it enriches a deterministic finding. */
  aiAnalysis?: AiAnalysis;
};

export type DiffHunk = {
  file: string;
  language: string;
  addedLines: Array<{ line: number; content: string }>;
  context: string;
};

export type AuditEventType =
  | "scan_passed"
  | "finding_detected"
  | "finding_blocked"
  | "patch_applied"
  | "override_requested"
  | "override_approved"
  | "override_denied";

export type AuditAction = "allowed" | "blocked" | "patched" | "overridden";

export type AuditEvent = {
  eventType: AuditEventType;
  repoName: string;
  repoPathHash: string;
  branch?: string;
  commitSha?: string;
  userId?: string;
  userEmail?: string;
  finding?: Finding;
  overrideReason?: string;
  jwtClaims?: Record<string, unknown>;
  action: AuditAction;
  createdAt: Date;
};
