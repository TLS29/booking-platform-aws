import pino from "pino";
import { env } from "./env";
import { RequestContext } from "../observability/requestContext";

export const logger = pino({
  level: env.logLevel,
  mixin() {
    const ctx = RequestContext.getContext();
    return ctx ? { correlationId: ctx.correlationId } : {};
  },
  ...(env.nodeEnv === "development" && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss",
        ignore: "pid,hostname",
      },
    },
  }),
});
