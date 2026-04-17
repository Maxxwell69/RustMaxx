/**
 * Public support addresses for mailto links (browser-safe via NEXT_PUBLIC_*).
 * Set in `.env` / hosting env; fallbacks match docs/SUPPORT_EMAILS_AND_COMMS.md.
 */

export function getPublicSupportEmails(): {
  serverAdmins: string;
  streamers: string;
  viewers: string;
} {
  return {
    serverAdmins:
      process.env.NEXT_PUBLIC_SUPPORT_EMAIL_SERVER_ADMINS?.trim() || "server-admins@rustmaxx.com",
    streamers:
      process.env.NEXT_PUBLIC_SUPPORT_EMAIL_STREAMERS?.trim() || "streamers@rustmaxx.com",
    viewers: process.env.NEXT_PUBLIC_SUPPORT_EMAIL_VIEWERS?.trim() || "viewers@rustmaxx.com",
  };
}
