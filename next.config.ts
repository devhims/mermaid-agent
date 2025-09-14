import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["mermaid"],
  // Alias DOMPurify to a server-safe stub in Node routes to avoid sanitize errors
  turbopack: {
    resolveAlias: {
      // Turbopack conditionals are limited; aliasing here affects both, but Webpack alias below
      // limits it to server in production builds.
      dompurify: "./src/shims/dompurify.server.ts",
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
