import type { NextConfig } from "next";

// Load root-level .env in local development only.
// On Vercel, env vars are injected by the platform — no file loading needed.
if (process.env.NODE_ENV !== "production") {
  const { config } = await import("dotenv");
  const { resolve } = await import("path");
  config({ path: resolve(process.cwd(), "../.env") });
}

const nextConfig: NextConfig = {};

export default nextConfig;
