import { Router } from "express";

const DB_CHECK_TIMEOUT_MS = 1000;

/**
 * Corre una promesa contra un límite de tiempo. Si no resuelve antes de `ms`,
 * rechaza con un error de timeout. Promise.race: gana el primero que termine,
 * sea la promesa real o el reloj.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param checkDb función que verifica conectividad con la DB. El router NO sabe
 *                que por debajo es Prisma; solo recibe "algo que me dice si la
 *                DB responde". Quien arma la app (composition root) decide la
 *                implementación concreta.
 */
export function createHealthRouter(checkDb: () => Promise<void>): Router {
  const router = Router();

  router.get("/live", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/ready", async (req, res) => {
    try {
      await withTimeout(checkDb(), DB_CHECK_TIMEOUT_MS);
      res.status(200).json({ status: "ok", checks: { db: "ok" } });
    } catch {
      res.status(503).json({ status: "fail", checks: { db: "fail" } });
    }
  });

  return router;
}
