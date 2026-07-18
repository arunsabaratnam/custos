import { basename } from "node:path";
import { createHash } from "node:crypto";
import mongoose, { type Model } from "mongoose";
import { execa } from "execa";
import { auditEventSchema } from "./model.js";
import { connectMongo } from "./mongo.js";
import type { AuditEvent } from "../scanner/types.js";

/**
 * Audit ledger writes/reads.
 *
 * scan.ts calls writeAuditEvent with only the event-specific fields
 * (eventType/finding/action/createdAt). This layer lazily connects and
 * enriches the record with repo metadata (name, privacy-hashed path,
 * branch, commit) before inserting, so the schema's required fields are
 * always satisfied and every event is queryable per repo/branch.
 */

type PartialAuditEvent = Partial<AuditEvent> & Pick<AuditEvent, "eventType" | "action" | "createdAt">;

const MODEL_NAME = "AuditEvent";

function auditModel(): Model<AuditEvent> {
  return (
    (mongoose.models[MODEL_NAME] as Model<AuditEvent> | undefined) ??
    mongoose.model<AuditEvent>(MODEL_NAME, auditEventSchema)
  );
}

async function git(args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execa("git", args);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Collects repo name / privacy-hashed path / branch / commit for the record. */
async function repoMetadata(): Promise<Pick<AuditEvent, "repoName" | "repoPathHash" | "branch" | "commitSha">> {
  const repoRoot = (await git(["rev-parse", "--show-toplevel"])) ?? process.cwd();
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commitSha = await git(["rev-parse", "HEAD"]);

  return {
    repoName: basename(repoRoot),
    repoPathHash: createHash("sha256").update(repoRoot).digest("hex"),
    branch,
    commitSha: commitSha?.slice(0, 40),
  };
}

export async function writeAuditEvent(event: PartialAuditEvent): Promise<void> {
  await connectMongo();
  const meta = await repoMetadata();

  const doc: AuditEvent = {
    ...meta,
    // Caller-provided values win over derived metadata (e.g. an explicit
    // commitSha or repoName if scan.ts ever supplies one).
    ...event,
    createdAt: event.createdAt ?? new Date(),
  };

  await auditModel().create(doc);
}

export async function listAuditEvents(limit = 20): Promise<AuditEvent[]> {
  await connectMongo();
  return auditModel()
    .find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<AuditEvent[]>()
    .exec();
}
