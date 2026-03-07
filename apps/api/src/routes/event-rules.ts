import { Router } from "express";

export const eventRulesRouter = Router();

// Placeholder: CRUD for event rules (which Twitch event → which whitelist action).
eventRulesRouter.get("/", (_req, res) => {
  res.status(501).json({ error: "Event rules module not implemented" });
});
