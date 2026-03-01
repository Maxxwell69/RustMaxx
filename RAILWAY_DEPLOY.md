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

### 4. HTTPS / “Not secure” (custom domain e.g. rustmaxx.com)

The “Not secure” warning appears when the site is loaded over **HTTP** instead of **HTTPS**. SSL is handled by **Railway**, not by the app code.

**To get HTTPS:**

1. **Add your custom domain in Railway**
   - Project → your web service → **Settings** → **Networking** (or **Domains**).
   - Add your domain, e.g. `rustmaxx.com` and optionally `www.rustmaxx.com`.

2. **Point DNS to Railway**
   - In your domain registrar (e.g. Cloudflare, Namecheap, GoDaddy), add the CNAME or A record Railway shows for your domain.
   - Wait for DNS to propagate (can take a few minutes to 48 hours).

3. **Use HTTPS when opening the site**
   - Open **https://rustmaxx.com** (with `https://`). Railway will issue and renew the certificate automatically.

4. **Optional: redirect HTTP → HTTPS**
   - In Railway, enable “Enforce HTTPS” or “Redirect HTTP to HTTPS” if the option is available in the service settings.

Until the custom domain is added in Railway and DNS points to it, Railway only serves HTTPS on the default `*.railway.app` URL. Using that URL (e.g. `https://your-app.railway.app`) will show as secure.
