import { Router } from "express";

export const twitchRouter = Router();

// Placeholder: Twitch webhook / link / events.
twitchRouter.post("/webhook", (_req, res) => {
  res.status(501).json({ error: "Twitch module not implemented" });
});
