/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  poweredByHeader: false,
  experimental: {
    webpackBuildWorker: true,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        aggregateTimeout: 300,
        poll: false,
      };
    }
    return config;
  },
};

export default nextConfig;
