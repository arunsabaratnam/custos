export type Severity = "low" | "medium" | "high" | "critical";

export type Finding = {
  id: string;
  severity: Severity;
  category: "secret" | "injection" | "auth" | "dependency" | "ai-safety";
  title: string;
  file: string;
  line?: number;
  evidence: string;
  explanation: string;
  recommendation: string;
  patch?: string;
  source: "rule" | "ai" | "hybrid";
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
