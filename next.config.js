/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      /** Legacy URLs in DB; GET is served by app/api/uploads/[filename] (not always reachable as static /public). */
      { source: "/uploads/:filename", destination: "/api/uploads/:filename" },
    ];
  },
  async headers() {
    return [
      {
        source: "/api/tikfinity/webhook",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://tikfinity.zerody.one" },
          { key: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
