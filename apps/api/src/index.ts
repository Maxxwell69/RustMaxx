import express from "express";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { serversRouter } from "./routes/servers";
import { twitchRouter } from "./routes/twitch";
import { eventRulesRouter } from "./routes/event-rules";

const app = express();
app.use(express.json());

app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/servers", serversRouter);
app.use("/twitch", twitchRouter);
app.use("/event-rules", eventRulesRouter);

const port = Number(process.env.API_PORT) || 3001;
app.listen(port, () => {
  console.log(`RustMaxx API listening on port ${port}`);
});
