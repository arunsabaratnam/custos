import type { AuditEvent } from "../scanner/types.js";

/**
 * Not implemented yet — later phase writes/reads AuditEvent documents
 * against the connection from src/audit/mongo.ts using the schema in
 * src/audit/model.ts.
 */
export async function writeAuditEvent(_event: AuditEvent): Promise<void> {
  throw new Error("writeAuditEvent: not implemented");
}

export async function listAuditEvents(_limit?: number): Promise<AuditEvent[]> {
  throw new Error("listAuditEvents: not implemented");
}
