import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "path";

// Load root-level .env in local development only.
// On Vercel, env vars are injected by the platform — no file loading needed.
if (process.env.NODE_ENV !== "production") {
  config({ path: resolve(process.cwd(), "../.env") });
}

const nextConfig: NextConfig = {};

export default nextConfig;
