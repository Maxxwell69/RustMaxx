# RustMaxx

Rust server web admin panel (RustAdmin Core MVP). Connects to Rust game servers via RCON and provides login, server management, live console/chat, and command runner. Deploy on Railway with Postgres.

## Stack

- **Next.js** (App Router) + TypeScript
- **Tailwind CSS**
- **Postgres** (Railway)
- **SSE** for realtime log stream
- **RCON** (server-side only; password never exposed to browser)

## Security (MVP)

- Admin login using `ADMIN_PASSWORD` from env
- Session cookie signed with `SESSION_SECRET`, 12h expiry
- All pages except `/login` require auth

**TODO (Phase 2):** Encrypt RCON password in DB; MVP stores plaintext.

## Local run

1. **Clone and install**

   ```bash
   cd rustmaxx
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set:

   - `DATABASE_URL` – Postgres connection string (e.g. `postgresql://user:pass@localhost:5432/rustmaxx`)
   - `ADMIN_PASSWORD` – password for admin login
   - `SESSION_SECRET` – at least 16 characters (used to sign session cookie)

3. **Database**

   ```bash
   npm run migrate
   ```

4. **Start**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000), go to `/login`, sign in, then add a server and connect.

## Railway deploy

1. **Create a project** on [Railway](https://railway.app) and add a **Postgres** service.

2. **Add your app** (GitHub repo or deploy from CLI). Link the Postgres service so `DATABASE_URL` is set.

3. **Variables**

   - `ADMIN_PASSWORD` – set a strong admin password
   - `SESSION_SECRET` – set a long random string (e.g. `openssl rand -hex 24`)
   - `NODE_ENV=production`

4. **Build & start**

   - Build: `npm run build` (or use Nixpacks/Railway default)
   - Start: `npm start`
   - Run migrations after first deploy: in Railway shell or one-off job run `npm run migrate`

5. **Log retention (optional)**

   To delete logs older than 7 days, run daily:

   ```bash
   npm run cleanup
   ```

   Use Railway cron if available, or document for manual/scheduled run.

## How to add a server and connect

1. Log in at `/login`.
2. On **Servers** (`/servers`), fill **Add server**: name, host (IP or hostname), RCON port (often `28016`), RCON password. Click **Add server**.
3. Open the server row to go to **Server detail** (`/servers/[id]`).
4. Click **Connect** to open a backend RCON connection for that server.
5. Use the command input or quick buttons (**status**, **players**, **say test**, **oxide.plugins**) to send commands. Live console and chat lines appear in the log area and are stored in Postgres (last 7 days retention with cleanup job).

## Scripts

- `npm run dev` – development server
- `npm run build` / `npm start` – production
- `npm run migrate` – run DB migrations in `db/migrations/`
- `npm run cleanup` – delete logs older than 7 days (run daily via cron or manually)

## API routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (body: `{ password }`), sets session cookie |
| POST | `/api/auth/logout` | Clears session cookie |
| GET | `/api/servers` | List servers |
| POST | `/api/servers` | Create server (name, host, port, password) |
| GET | `/api/servers/:id` | Server details |
| POST | `/api/servers/:id/connect` | Ensure RCON connection |
| GET | `/api/servers/:id/stream` | SSE stream of log events |
| POST | `/api/servers/:id/command` | Send RCON command (body: `{ command }`) |
| GET | `/api/servers/:id/logs?limit=200` | Initial logs for page load |

## License

MIT
