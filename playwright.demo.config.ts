import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/demo', workers: 1, retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:8791', trace: 'retain-on-failure' },
  projects: [{ name: 'recorded-desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'recorded-mobile', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'npx vite preview --outDir ../site --host 127.0.0.1 --port 8791 --strictPort', url: 'http://127.0.0.1:8791', reuseExistingServer: false },
});
