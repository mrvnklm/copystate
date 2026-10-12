import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  workers: '50%',
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testMatch: /(core|libs)\.spec\.js/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /(core|libs)\.spec\.js/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /(core|libs)\.spec\.js/ },
    { name: 'chrome-extension', testMatch: /extension\.spec\.js/ },
    { name: 'firefox-extension', testMatch: /extension-firefox\.spec\.js/ },
  ],
});
