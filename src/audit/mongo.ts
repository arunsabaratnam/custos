import mongoose, { type Connection } from "mongoose";

/**
 * MongoDB connection management.
 *
 * The connection is memoized so repeated audit writes in a single run reuse
 * one pool. A short server-selection timeout means an unreachable Atlas
 * fails fast (callers warn and continue) instead of hanging `git push`.
 * `disconnectMongo` must always be safe to call — including when we never
 * connected — because cli.ts calls it in a teardown `finally`.
 */

let connectionPromise: Promise<Connection> | null = null;
let connected = false;

export async function connectMongo(): Promise<Connection> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(uri, {
        dbName: process.env.MONGODB_DB ?? "custos",
        serverSelectionTimeoutMS: 2_500,
        connectTimeoutMS: 2_500,
        autoIndex: false,
      })
      .then((m) => {
        connected = true;
        return m.connection;
      })
      .catch((err) => {
        // Reset so a later call can retry rather than reusing a rejected promise.
        connectionPromise = null;
        throw err;
      });
  }

  return connectionPromise;
}

/** Starts the connection in the background so scan work can hide Atlas latency. */
export function warmMongoConnection(): void {
  void connectMongo().catch(() => {
    // The eventual audit write reports the integration failure to the user.
  });
}

export async function disconnectMongo(): Promise<void> {
  if (!connected && !connectionPromise) {
    return;
  }
  try {
    await mongoose.disconnect();
  } finally {
    connected = false;
    connectionPromise = null;
  }
}
