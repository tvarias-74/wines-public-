import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build (`npm run build`), served by `vite preview`,
 * plus a second server that mimics GitHub Pages hosting under /wines-public-/.
 *
 * Locally: `npx playwright install chromium` once, then `npm run e2e`.
 * Set PW_CHROMIUM_PATH to use an existing Chromium/Chrome binary instead.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    locale: 'en-US',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: { executablePath, args: ['--no-sandbox'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: 'node e2e/serve-subpath.mjs dist 4180', url: 'http://localhost:4180/wines-public-/', reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
});
