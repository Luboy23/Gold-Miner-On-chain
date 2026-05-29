import { defineConfig } from '@playwright/test';

const useManagedWebServer = process.env.PLAYWRIGHT_NO_WEBSERVER !== '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: {
      width: 1440,
      height: 1080,
    },
  },
  webServer: useManagedWebServer
    ? {
        command: 'npm run dev -- --host 127.0.0.1 --port 4174',
        url: 'http://127.0.0.1:4174',
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
