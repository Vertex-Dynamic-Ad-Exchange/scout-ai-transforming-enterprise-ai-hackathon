import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// VITE_DASHBOARD_BACKEND_URL is loaded at config time (not bundled) so
// the dev proxy can target `@scout/dashboard-backend`. Vite's `VITE_*`
// exposure model ships every VITE_* into the client bundle — the
// bundle-grep test in `__bundle__/no-secrets.test.ts` pins the
// no-secrets rule (CLAUDE.md § Working agreements).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.VITE_DASHBOARD_BACKEND_URL ?? "http://localhost:5174";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
