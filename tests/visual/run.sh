#!/bin/sh
# The visual tests: the web demo (Playwright) and the CLI demo (VHS). Both always run and always
# record; the exit status is a failure if either failed. Run in the Docker image: npm run test:visual.
cd "$(dirname "$0")/../.."
rm -rf tests/visual/screenshots tests/visual/results
mkdir -p tests/visual/screenshots tests/visual/results
status=0
npx playwright test -c tests/visual/playwright.config.ts || status=1
vhs tests/visual/cli.tape || status=1
[ -f tests/visual/screenshots/cli-partial-scan.png ] || { echo 'cli.tape took no screenshot' >&2; status=1; }
exit $status
