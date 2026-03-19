/* eslint-disable @typescript-eslint/no-var-requires */
const WebRcon = require("webrconjs");

type Args = {
  host: string;
  port: number;
  password: string;
  command: string;
  timeoutMs: number;
  settleMs: number;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const map = new Map<string, string>();
  for (let i = 0; i < raw.length; i += 2) {
    const key = raw[i];
    const val = raw[i + 1];
    if (!key?.startsWith("--") || val == null) continue;
    map.set(key.slice(2), val);
  }

  const host = map.get("host") ?? "";
  const port = Number(map.get("port") ?? "0");
  const password = map.get("password") ?? "";
  const command = map.get("command") ?? "";
  const timeoutMs = Number(map.get("timeoutMs") ?? "15000");
  const settleMs = Number(map.get("settleMs") ?? "1200");

  if (!host || !port || !password || !command) {
    throw new Error(
      "Usage: npx tsx scripts/rcon-send.ts --host <ip> --port <port> --password <pass> --command \"oxide.reload RustChaos\" [--timeoutMs 15000] [--settleMs 1200]"
    );
  }

  return { host, port, password, command, timeoutMs, settleMs };
}

async function run(): Promise<void> {
  const args = parseArgs();

  await new Promise<void>((resolve, reject) => {
    const client = new WebRcon(args.host, args.port);
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try {
        client.disconnect();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve();
    };

    const timeout = setTimeout(() => {
      finish(new Error("RCON timeout: no response from server."));
    }, args.timeoutMs);

    client.once("connect", () => {
      try {
        client.run(args.command, 1);
        setTimeout(() => finish(), args.settleMs);
      } catch (err) {
        clearTimeout(timeout);
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });

    client.on("message", (msg: { message?: string; identity?: number }) => {
      const text = String(msg?.message ?? "").trim();
      if (text) console.log(text);
    });

    client.once("error", (err: Error) => {
      clearTimeout(timeout);
      finish(err);
    });

    client.connect(args.password);
  });
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
