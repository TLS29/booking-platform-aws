import http from "node:http";
import { createApp } from "#interfaces/http/app";
import { env } from "#infrastructure/config/env";
import { logger } from "#infrastructure/config/logger";
import { createPrismaClient } from "#infrastructure/persistence/prisma/client";

const prisma = createPrismaClient();
const checkDb = async () => {
  await prisma.$queryRaw`SELECT 1`;
};
const app = createApp(checkDb);
const server = http.createServer(app);

server.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv }, "Server started");
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received.");
  server.close(async () => {
    await prisma.$disconnect();
    logger.info("Closed out remaining connections");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received.");
  server.close(async () => {
    await prisma.$disconnect();
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
