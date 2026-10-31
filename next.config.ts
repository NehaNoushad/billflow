import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is user-specific and database-backed, so render on each request (no Cache Components).
  serverExternalPackages: ["mongoose", "jspdf", "jspdf-autotable"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
