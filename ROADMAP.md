# RustMaxx site cleanup — check off as you go

Use this list to track progress. Edit the checkboxes (`- [ ]` → `- [x]`) as you complete each item.

---

## 1. Admin server (RustAdmin-style)

- [x] Add / edit / delete servers (RCON host, port, password)
- [x] Connect via WebRCON and live console
- [x] Run commands and see output
- [x] Quick presets (status, players, env, events)
- [x] Live log stream (console + chat)
- [x] Server listing (opt-in, name, description, game host/port, logo)
- [x] Public server list page
- [ ] Encrypt RCON password in DB (Phase 2)
- [ ] Scheduled commands
- [ ] Plugin management (Oxide/uMod list / load / unload)

---

## 2. Streamer interaction

- [x] Marketing page and copy
- [ ] Twitch OAuth (connect channel)
- [ ] Reward mapping (bits, channel points, subs → in-game actions)
- [ ] Cooldowns and anti-abuse (per-user, per-reward)
- [ ] Live trigger execution (plugin/service)
- [ ] TikTok / Kick adapters (planned)
- [ ] Overlays (OBS browser source)

---

## 3. Player interaction

- [ ] Define scope (e.g. in-game rewards, queue, votes)
- [ ] Player-facing UI or plugin hooks
- [ ] Integration with admin/streamer flows

---

## 4. Mod / plugins sales system

- [ ] Catalog or listing model
- [ ] Payments (Stripe or other)
- [ ] Delivery / license keys or plugin store
- [ ] Integration with RustMaxx servers (optional)

---

## 5. Sign-up system for users

- [x] Users table (and migration)
- [x] Sign-up flow (email/password or OAuth)
- [ ] Email verification (optional)
- [x] Replace single ADMIN_PASSWORD with user-based login for dashboard
- [ ] Password reset

---

## 6. Permission-based system

- [x] Roles table or enum (e.g. super_admin, server_admin, moderator, viewer)
- [x] Link users to servers and roles (e.g. user X is admin on server A, moderator on server B)
- [x] Middleware / API checks by role (who can add server, run RCON, edit listing, etc.)
- [x] UI: show/hide or disable actions by permission
- [x] Audit log stores user id and role

---

## 7. Go High Level email and integration

- [ ] Set up Go High Level account / pipeline
- [ ] Connect early-access and contact forms to Go High Level (API or webhook)
- [ ] Email automation (welcome, nurture, notifications)
- [ ] Lead/contact sync from RustMaxx to Go High Level

---

## 8. Discord Server Integration and building

- [ ] Create and configure Discord server for RustMaxx community
- [ ] Bot or webhook integration (e.g. notify Discord on sign-ups, server events)
- [ ] Discord OAuth / “Login with Discord” (optional)
- [ ] Roles, channels, and moderation setup
- [ ] Link Discord from marketing site (footer, contact, or dedicated page)
