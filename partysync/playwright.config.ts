import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5178",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node ../server/server.js",
      url: "http://127.0.0.1:3008/api/health",
      env: { PORT: "3008", FRONTEND_URL: "http://127.0.0.1:5178" },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5178 --strictPort",
      url: "http://127.0.0.1:5178",
      env: { VITE_BACKEND_URL: "http://127.0.0.1:3008" },
    },
  ],
});
