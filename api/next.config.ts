import path from "node:path";
import type { NextConfig } from "next";

// à garder identique à API_VERSION dans packages/shared (la config ne peut pas importer ce paquet)
const API_VERSION = 1;
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  transpilePackages: ["@wikideck/shared"],
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  // /v1/... est la même API que les chemins sans préfixe, qui restent servis : pendant un
  // déploiement l'ancien site appelle encore les anciens chemins, et le callback Discord n'en change pas
  async rewrites() {
    return [{ source: `/v${API_VERSION}/:path*`, destination: "/:path*" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: webOrigin },
          { key: "Access-Control-Allow-Credentials", value: "true" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
          { key: "Access-Control-Expose-Headers", value: "X-Api-Version" },
          { key: "X-Api-Version", value: String(API_VERSION) },
          { key: "Vary", value: "Origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
