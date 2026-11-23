import { defineConfig } from "@playwright/test";

const baseURL = process.env.BUSINESSOS_E2E_URL;
if (!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseURL)) {
  throw new Error("Set BUSINESSOS_E2E_URL to an isolated local BusinessOS test instance.");
}

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
});
