import { Router } from "express";

const healthRouter: Router = Router();

// TODO(epic-01-persistence): implementar /health/ready cuando exista Prisma client. Debe checar DB con timeout corto y devolver 503 si falla.

healthRouter.get("/live", (req, res) => {
  res.status(200).json({ status: "ok" });
});

export default healthRouter;
