import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  plugins: [
    react(),
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
