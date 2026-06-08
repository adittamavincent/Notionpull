/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
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

      // LocatorJS: inject source locations via webpack loader instead of babel.
      // This keeps SWC active for Fast Refresh while still enabling click-to-source.
      if (!isServer) {
        config.module.rules.push({
          test: /\.(tsx|ts|jsx|js)$/,
          exclude: /node_modules/,
          use: [
            {
              loader: "@locator/webpack-loader",
              options: {
                env: "development",
              },
            },
          ],
        });
      }
    }
    return config;
  },
};

export default nextConfig;
