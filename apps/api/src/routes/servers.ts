import { Router } from "express";

export const serversRouter = Router();

// Placeholder: server registration and connection token management.
serversRouter.get("/", (_req, res) => {
  res.status(501).json({ error: "Server registration module not implemented" });
});
