import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["mermaid"],
  // Alias DOMPurify to a server-safe stub in Node routes to avoid sanitize errors
  experimental: {
    turbo: {
      resolveAlias: {
        // Turbopack conditionals are limited; aliasing here affects both, but Next falls back
        // to webpack alias below for server specificity.
        dompurify: "./src/shims/dompurify.server.ts",
      },
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};
      config.resolve.alias["dompurify"] = require.resolve("./src/shims/dompurify.server.ts");
    }
    return config;
  },
};

export default nextConfig;
