import { createServer } from "./server";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT) || 3040;

createServer(GATEWAY_PORT).then((server) => {
  console.log(`RustMaxx realtime gateway listening on port ${GATEWAY_PORT}`);
}).catch((err) => {
  console.error("Failed to start gateway:", err);
  process.exit(1);
});
