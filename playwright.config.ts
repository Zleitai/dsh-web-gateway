import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir: './tests/browser', timeout: 45000, workers: 1,
 use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', screenshot: 'only-on-failure' },
 webServer: [
  { command: 'pnpm dev:demo', url: 'http://127.0.0.1:4101/state', reuseExistingServer: false },
  { command: 'pnpm --filter @dsh-mobile/mobile preview', url: 'http://127.0.0.1:5173', reuseExistingServer: false }
 ],
 projects: [{ name: 'android-chrome', use: { ...devices['Pixel 7'] } }, { name: 'iphone-webkit', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } }],
});
