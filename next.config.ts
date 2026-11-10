import type { NextConfig } from 'next';

// Server-rendered on Vercel: API routes (app/api) talk to Postgres. Screens
// still compute every figure in the browser from the org's dataset.
const nextConfig: NextConfig = {
  trailingSlash: true,
  // API routes answer with or without the slash (Better Auth's client calls
  // them without); pages keep their trailing-slash URLs.
  skipTrailingSlashRedirect: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
