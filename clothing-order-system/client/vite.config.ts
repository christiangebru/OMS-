import path from "path";
import { execSync } from "child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function resolveCommitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.VITE_COMMIT_SHA) return process.env.VITE_COMMIT_SHA;
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    return execSync("git rev-parse HEAD", { timeout: 1000 }).toString().trim();
  } catch {
    return "unknown";
  }
}

const commitSha = resolveCommitSha();

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  define: {
    "import.meta.env.VITE_COMMIT_SHA": JSON.stringify(commitSha)
  },
  plugins: [
    react(),
    {
      name: "version-emitter",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ commit: commitSha }, null, 2)
        });
      },
      transformIndexHtml(html) {
        return html.replace(
          "</head>",
          `  <meta name="build-commit" content="${commitSha}" />\n  </head>`
        );
      }
    },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Clothing Order Management",
        short_name: "ClothOrders",
        description: "Production-ready clothing order management",
        theme_color: "#3e5c48",
        background_color: "#F4F0E8",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        /** Avoid Rollup/Terser hook race on some Node versions during SW generation */
        mode: "development"
      }
    })
  ],
 server: {
  port: 5173,
  proxy: {
    "/api": { target: "http://localhost:4000", changeOrigin: true },
    "/uploads": { target: "http://localhost:4000", changeOrigin: true }
  }
}
});
