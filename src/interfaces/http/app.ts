import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middlewares/errorHandler";
import { correlationIdMiddleware } from "./middlewares/correlationId";
import { requestLogger } from "./middlewares/requestLogger";
import { DomainError } from "#domain/errors/DomainError";
import healthRouter from "./routes/health";

export const app: Express = express();

app.use(correlationIdMiddleware);
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// ───────────────────────────── Routes ─────────────────────────────
app.use("/health", healthRouter);
// ─────────────────────────── End routes ───────────────────────────

app.use((req, _res, next) => {
  next(
    new DomainError(
      "NOT_FOUND",
      `Route ${req.method} ${req.originalUrl} not found`,
      404,
    ),
  );
});
app.use(errorHandler);
