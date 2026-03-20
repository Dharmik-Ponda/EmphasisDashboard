import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  outputFileTracingRoot: __dirname,
  webpack: (config) => {
    // Avoid warnings for optional @next/swc-* packages that aren't installed
    if (Array.isArray(config.snapshot?.managedPaths)) {
      const token = "/@next/swc-";
      config.snapshot.managedPaths = config.snapshot.managedPaths.filter(
        (p) => typeof p !== "string" || !p.includes(token)
      );
    }
    return config;
  }
};

export default nextConfig;
