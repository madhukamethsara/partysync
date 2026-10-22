import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", workers: 1, timeout: 45000,
  webServer: [
    { command: "node ../server/server.js", url: "http://127.0.0.1:3009/api/health",
      env: { PORT: "3009", FRONTEND_URL: "http://127.0.0.1:5179" } },
    { command: "npm --prefix ../partysync run dev -- --host 127.0.0.1 --port 5179 --strictPort",
      url: "http://127.0.0.1:5179", env: { VITE_BACKEND_URL: "http://127.0.0.1:3009" } },
  ],
});
