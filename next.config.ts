import type { NextConfig } from 'next';

// Static export: `pnpm build` writes a plain site to out/ that any static host serves.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
