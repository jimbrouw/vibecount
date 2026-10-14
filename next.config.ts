import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  reactCompiler: true,
};

export default nextConfig;
