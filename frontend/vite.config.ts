import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.resolve(frontendDir, "../certs");
const certFile = path.join(certDir, "server.crt");
const keyFile = path.join(certDir, "server.key");
const hasLocalCert = fs.existsSync(certFile) && fs.existsSync(keyFile);
const httpsRequired = process.env.VITE_HTTPS_REQUIRED === "1";
const httpsEnabled = process.env.VITE_HTTPS !== "0" && hasLocalCert;
const devHost = process.env.VITE_DEV_HOST?.trim() || "localhost";
const devApiTarget =
  process.env.VITE_DEV_API_TARGET?.trim() || "http://127.0.0.1:8765";

if (httpsRequired && !httpsEnabled) {
  throw new Error(
    "Local HTTPS is required but certs/server.crt or certs/server.key is missing. " +
      "Run .\\scripts\\setup-https.ps1 first.",
  );
}

const httpsOptions = httpsEnabled
  ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
  : undefined;

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    host: devHost,
    port: 5173,
    strictPort: true,
    https: command === "serve" ? httpsOptions : undefined,
    proxy: {
      "/api": {
        target: devApiTarget,
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: devHost,
    port: 4173,
    strictPort: true,
    https: httpsOptions,
    proxy: {
      "/api": {
        target: devApiTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.ts",
    css: false,
    restoreMocks: true,
  },
}));
