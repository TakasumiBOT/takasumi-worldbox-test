const nextConfig = {
  output: "standalone",
  async headers() {
    const frameAncestors = {
      key: "Content-Security-Policy",
      value:
        "frame-ancestors 'self' https://discord.com https://*.discord.com https://*.discordsays.com",
    };
    return [
      { source: "/games", headers: [frameAncestors] },
      { source: "/games/:path*", headers: [frameAncestors] },
    ];
  },
};
export default nextConfig;
