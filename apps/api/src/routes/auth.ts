import { Router } from "express";

export const authRouter = Router();

// Placeholder: auth module (login, session, link Twitch).
authRouter.get("/me", (_req, res) => {
  res.status(501).json({ error: "Auth module not implemented" });
});
