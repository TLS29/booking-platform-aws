import http from "node:http";
import { app } from "./interfaces/http/app";
import { env } from "./infrastructure/config/env";
import { logger } from "./infrastructure/config/logger";

const server = http.createServer(app);

server.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, "Server started");
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received.");
  server.close(() => {
    logger.info("Closed out remaining connections");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received.");
  server.close(() => {
    logger.info("Closed out remaining connections");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled rejection");
  process.exit(1);
});
