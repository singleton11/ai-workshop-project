#!/bin/sh
# The visual tests: the web demos (Playwright) and the CLI demos (VHS). Both always run and always
# record; the exit status is a failure if either failed. Run in the Docker image: npm run test:visual.
cd "$(dirname "$0")/../.."
rm -rf tests/visual/screenshots tests/visual/results
mkdir -p tests/visual/screenshots tests/visual/results
status=0
npx playwright test -c tests/visual/playwright.config.ts || status=1
for tape in cli last-updated nicer-list clustering empty-input; do vhs tests/visual/$tape.tape || status=1; done
for screenshot in cli-partial-scan cli-last-updated cli-nicer-list cli-nicer-list-piped cli-clustering cli-clustering-filter cli-clustering-error cli-empty-input cli-empty-input-set; do
  [ -f tests/visual/screenshots/$screenshot.png ] || { echo "no $screenshot.png: a tape took no screenshot" >&2; status=1; }
done
exit $status
