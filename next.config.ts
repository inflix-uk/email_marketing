import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only packages: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["mongodb", "nodemailer"],
  experimental: {
    serverActions: {
      // CSV contact imports can be a few MB.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
