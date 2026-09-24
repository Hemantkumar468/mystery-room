import mongoose from "mongoose";
import { config } from "./index.js";
import { logger } from "./logger.js";
import dns from "dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

mongoose.set("strictQuery", true);

/**
 * Connect to MongoDB with sensible pool + timeout defaults and lifecycle logging.
 * Retries are intentionally NOT swallowed here — the caller decides boot behaviour.
 */
export async function connectDatabase() {
  const conn = await mongoose.connect(config.db.uri, {
    maxPoolSize: 20,
    minPoolSize: 2,
    /**
     * Server selection has to cover DNS, a TCP connect and a TLS handshake to
     * *every* replica-set member before a primary can be chosen. On a healthy
     * link that is well under a second; on a lossy one a single TCP connect to
     * an Atlas node has been measured here at 2–4.5s, so the 10s default
     * expired mid-discovery and surfaced as `ReplicaSetNoPrimary` — a
     * misleading error, since the set had a primary the whole time and it was
     * simply not reached yet.
     */
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS: 20_000,
    socketTimeoutMS: 45_000,
    // Retry a read that dies mid-flight when a heartbeat drops, instead of
    // surfacing a transient network blip as a request failure.
    retryReads: true,
    autoIndex: !config.isProd, // build indexes in dev; manage explicitly in prod
  });

  logger.info(
    `MongoDB connected → ${conn.connection.host}/${conn.connection.name}`,
  );

  mongoose.connection.on("error", (err) =>
    logger.error("MongoDB connection error", err),
  );
  // The driver reconnects on its own. Both sides of that cycle are logged so a
  // lone "disconnected" is not mistaken for a dead connection — without the
  // matching "reconnected" line, a routine blip reads like an outage.
  mongoose.connection.on("disconnected", () =>
    logger.warn("MongoDB disconnected — driver will retry"),
  );
  mongoose.connection.on("reconnected", () =>
    logger.info("MongoDB reconnected"),
  );

  return conn;
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
  logger.info("MongoDB connection closed");
}

export default connectDatabase;
