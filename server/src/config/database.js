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
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    autoIndex: !config.isProd, // build indexes in dev; manage explicitly in prod
  });

  logger.info(
    `MongoDB connected → ${conn.connection.host}/${conn.connection.name}`,
  );

  mongoose.connection.on("error", (err) =>
    logger.error("MongoDB connection error", err),
  );
  mongoose.connection.on("disconnected", () =>
    logger.warn("MongoDB disconnected"),
  );

  return conn;
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
  logger.info("MongoDB connection closed");
}

export default connectDatabase;
