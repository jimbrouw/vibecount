import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/receipts": ["./node_modules/pdfjs-dist/standard_fonts/**/*"],
    "/api/receipts/*": ["./node_modules/pdfjs-dist/standard_fonts/**/*"],
    "/api/receipts/*/source": ["./node_modules/pdfjs-dist/standard_fonts/**/*"],
  },
  reactCompiler: true,
};

export default nextConfig;
