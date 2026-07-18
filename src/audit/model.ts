import { Schema } from "mongoose";
import type { AuditEvent } from "../scanner/types.js";

export const auditEventSchema = new Schema<AuditEvent>({
  eventType: { type: String, required: true },
  repoName: { type: String, required: true },
  repoPathHash: { type: String, required: true },
  branch: { type: String },
  commitSha: { type: String },
  userId: { type: String },
  userEmail: { type: String },
  finding: { type: Schema.Types.Mixed },
  overrideReason: { type: String },
  jwtClaims: { type: Schema.Types.Mixed },
  action: { type: String, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
});
