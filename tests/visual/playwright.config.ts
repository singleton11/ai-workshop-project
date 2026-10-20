// Demos as visual tests: spec in tests/visual/README.md. Run with `npm run test:visual`.
import { defineConfig } from '@playwright/test';

const DIR = import.meta.dirname;
const PORT = 4188;

export default defineConfig({
  testDir: DIR,
  outputDir: `${DIR}/results`,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    video: { mode: 'on', size: { width: 1280, height: 800 } }, // every run, passing or failing
    trace: 'retain-on-failure',
    launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] },
  },
  webServer: {
    // GitHub answers from net.json; the drop is switched per step through DROP_FILE.
    command: `node --import ./.agents/skills/record-feature-video/scripts/flaky.mjs src/cli.ts serve --port ${PORT}`,
    cwd: `${DIR}/../..`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    env: {
      REPLAY: `${DIR}/net.json`,
      DROP_FILE: `${DIR}/results/drop-after`,
      SKILL_ATLAS_RULES: `${DIR}/rules.yaml`,
      GITHUB_TOKEN: '',
    },
  },
});
