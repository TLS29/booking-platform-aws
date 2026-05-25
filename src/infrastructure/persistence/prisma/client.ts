import { PrismaClient } from "@prisma/client";

/**
 * Factory del PrismaClient singleton.
 *
 * Se llama UNA vez al arrancar la app (en main.ts) y la instancia
 * resultante se inyecta por constructor a todos los repos y al
 * /health/ready check.
 *
 * No instanciar PrismaClient en cada archivo: cada `new PrismaClient()`
 * abre su propio pool de conexiones a Postgres.
 */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export type { PrismaClient } from "@prisma/client";
