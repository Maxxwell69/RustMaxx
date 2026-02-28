# Railway deploy checklist

## After each deploy

### 1. Run database migrations

The app does **not** run migrations automatically. After the first deploy (and after any new migration files), run:

**Option A – from your machine (with Railway CLI linked):**

```bash
railway run npm run migrate
```

**Option B – from Railway Dashboard:**

1. Open your project → your app service.
2. Open the **Shell** tab (or run a one-off command if available).
3. Run: `npm run migrate`

Migrations use the `DATABASE_URL` from your Railway project. Ensure the app service is linked to your Postgres service so `DATABASE_URL` is set.

### 2. Logo and static files

- The logo is at `public/rustmaxx-logo.png`. It must be committed to the repo so Railway includes it in the build.
- If the logo fails to load in production, the UI shows a “RustMaxx” text fallback. To fix the image: ensure `public/rustmaxx-logo.png` exists and is not in `.gitignore`, then push and redeploy.

### 3. Required env vars

- `DATABASE_URL` – set by linking the Postgres service
- `ADMIN_PASSWORD` – admin login password
- `SESSION_SECRET` – long random string for session signing
- `NODE_ENV=production`
