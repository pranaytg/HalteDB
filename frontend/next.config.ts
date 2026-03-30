import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "path";

// Load root .env so API routes can access Shiprocket creds, origin pincode, etc.
config({ path: resolve(__dirname, "../.env") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
