import type { Connection } from "mongoose";

/**
 * MongoDB connection management.
 *
 * Not implemented yet — later phase connects using MONGODB_URI /
 * MONGODB_DB. Per AGENTS.md's invariants: in normal scan mode, a missing
 * or unreachable MongoDB must warn to stderr and continue, never crash
 * the hook. In override mode, a successful write should be preferred
 * before allowing the push, since accountability is the point of override.
 */
export async function connectMongo(): Promise<Connection> {
  throw new Error("connectMongo: not implemented");
}

export async function disconnectMongo(): Promise<void> {
  throw new Error("disconnectMongo: not implemented");
}
