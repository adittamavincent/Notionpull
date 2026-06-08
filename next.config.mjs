/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  poweredByHeader: false,
  experimental: {
    webpackBuildWorker: true,
  },
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.watchOptions = {
        aggregateTimeout: 2000,
        poll: false,
        ignored: [
          "**/node_modules/**",
          "**/.next/**",
          "**/.git/**",
          "**/out/**",
          "**/public/**",
        ],
      };

      // Use deterministic IDs to prevent chunk reference failures during HMR.
      // Without this, webpack uses numeric IDs (309.js, 412.js) that shift
      // on every recompilation, causing "Cannot find module './309.js'" errors.
      if (isServer) {
        config.optimization = {
          ...config.optimization,
          moduleIds: "deterministic",
          chunkIds: "deterministic",
        };
      }
    }
    return config;
  },
};

export default nextConfig;
