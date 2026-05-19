import pinoHttp from "pino-http";
import { logger } from "#infrastructure/config/logger";

export const requestLogger = pinoHttp({ logger });
